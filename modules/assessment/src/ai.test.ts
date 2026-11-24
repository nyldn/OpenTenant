import { afterEach, describe, expect, it, vi } from "vitest"
import { ReadoutTransportError, streamReadout } from "./ai"

const encoder = new TextEncoder()

function eventStream(...chunks: string[]): Response {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  }))
}

describe("Assessment readout transport", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("assembles SSE deltas and stops at the done terminal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(eventStream(
      ": keepalive\n\nignored framing\n\ndata: {\"delta\":\"First \"}\n",
      "\ndata: {\"delta\":\"step\"}\n\ndata: {\"done\":true}\n\n",
    )))
    const onDelta = vi.fn()

    await expect(streamReadout("synthetic summary", { onDelta })).resolves.toBe("First step")
    expect(onDelta).toHaveBeenNthCalledWith(1, "First ")
    expect(onDelta).toHaveBeenNthCalledWith(2, "First step")
  })

  it("rejects malformed data frames without exposing their payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(eventStream(
      "data: {malformed credential detail}\n\n",
    )))

    const failure = streamReadout("synthetic summary", { onDelta: vi.fn() })

    await expect(failure).rejects.toEqual(new ReadoutTransportError("failed"))
    await expect(failure).rejects.not.toThrow("malformed credential detail")
  })

  it.each([
    ["null", "null"],
    ["a primitive", '"credential detail"'],
    ["an array", '[{"delta":"credential detail"}]'],
    ["a non-string delta", '{"delta":42}'],
    ["a non-literal done value", '{"done":"yes"}'],
    ["done false", '{"done":false}'],
    ["a non-string error", '{"error":42}'],
    ["no recognized event", '{"detail":"credential detail"}'],
    ["ambiguous terminal and delta", '{"delta":"credential detail","done":true}'],
    ["an extra property", '{"done":true,"detail":"credential detail"}'],
  ])("rejects %s instead of accepting a later terminal", async (_case, payload) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(eventStream(
      `data: ${payload}\n\ndata: {"done":true}\n\n`,
    )))
    const onDelta = vi.fn()

    const failure = streamReadout("synthetic summary", { onDelta })

    await expect(failure).rejects.toEqual(new ReadoutTransportError("failed"))
    await expect(failure).rejects.not.toThrow("credential detail")
    expect(onDelta).not.toHaveBeenCalled()
  })

  it.each([
    ["before any delta", "", 0],
    ["after a valid delta", 'data: {"delta":"partial"}\n\n', 1],
  ] as const)("rejects EOF %s when no done terminal arrives", async (_case, body, deltaCalls) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(eventStream(body)))
    const onDelta = vi.fn()

    await expect(streamReadout("synthetic summary", { onDelta })).rejects.toEqual(
      new ReadoutTransportError("failed"),
    )
    expect(onDelta).toHaveBeenCalledTimes(deltaCalls)
  })

  it.each([
    [503, "unavailable", "model unavailable"],
    [418, "failed", "readout failed"],
  ] as const)("bounds an HTTP %i response without exposing its body", async (status, code, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("sensitive backend detail", { status }),
    ))

    const failure = streamReadout("synthetic summary", { onDelta: vi.fn() })

    await expect(failure).rejects.toMatchObject({
      name: "ReadoutTransportError",
      code,
      message,
    })
    await expect(failure).rejects.not.toThrow("sensitive backend detail")
  })

  it("bounds a server-sent failure without exposing its payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(eventStream(
      'data: {"error":"credential backend leaked a secret"}\n\n',
    )))

    const failure = streamReadout("synthetic summary", { onDelta: vi.fn() })

    await expect(failure).rejects.toEqual(new ReadoutTransportError("failed"))
    await expect(failure).rejects.not.toThrow("credential backend leaked a secret")
  })

  it("bounds a network failure without exposing dependency detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      new Error("socket path and upstream hostname"),
    ))

    const failure = streamReadout("synthetic summary", { onDelta: vi.fn() })

    await expect(failure).rejects.toMatchObject({
      name: "ReadoutTransportError",
      code: "failed",
      message: "readout failed",
    })
    await expect(failure).rejects.not.toThrow("socket path and upstream hostname")
  })

  it("forwards caller cancellation and preserves AbortError", async () => {
    const abort = new AbortController()
    let forwardedSignal: AbortSignal | undefined
    vi.stubGlobal("fetch", vi.fn().mockImplementation(
      (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        forwardedSignal = init.signal ?? undefined
        forwardedSignal?.addEventListener("abort", () => {
          reject(new DOMException("caller cancelled", "AbortError"))
        }, { once: true })
      }),
    ))

    const failure = streamReadout("synthetic summary", { onDelta: vi.fn(), signal: abort.signal })
    abort.abort()

    expect(forwardedSignal).toBe(abort.signal)
    await expect(failure).rejects.toMatchObject({ name: "AbortError" })
  })
})
