import { describe, expect, it } from "vitest"
import { isStoredReadoutCurrent, ReadoutRequestController, readoutTextForPdf, runReadoutRequest } from "./assessment-results"

const readout = { text: "Synthetic readout", generatedAt: "2026-09-06T00:00:00.000Z", inputDigest: "sha256:" + "a".repeat(64) }

describe("Assessment result readout freshness", () => {
  it("shows a restored readout as current only for the matching digest and input version", () => {
    expect(isStoredReadoutCurrent(readout, readout.inputDigest, "inputs-a", "inputs-a")).toBe(true)
    expect(isStoredReadoutCurrent(readout, "sha256:" + "b".repeat(64), "inputs-a", "inputs-a")).toBe(false)
    expect(isStoredReadoutCurrent(readout, readout.inputDigest, "inputs-a", "inputs-b")).toBe(false)
  })

  it("keeps unbound readouts stale and excludes preview or stale text from PDF", () => {
    const unbound = { ...readout, generatedAt: null, inputDigest: null }
    expect(isStoredReadoutCurrent(unbound, null, "inputs-a", "inputs-a")).toBe(false)
    expect(readoutTextForPdf(readout, false)).toBe("")
    expect(readoutTextForPdf(readout, true)).toBe(readout.text)
  })

  it("invalidates a request before a delayed terminal digest can save", async () => {
    const controller = new ReadoutRequestController(); controller.mount(); const abort = new AbortController(); const token = controller.begin(abort.signal)
    let saved = false
    const terminal = Promise.resolve("Synthetic complete")
    await terminal
    controller.invalidate()
    await Promise.resolve()
    if (controller.isLive(token)) saved = true
    expect(saved).toBe(false)
  })

  it("rejects preview callbacks after abort and unmount", () => {
    const controller = new ReadoutRequestController(); controller.mount(); const abort = new AbortController(); const token = controller.begin(abort.signal)
    abort.abort()
    expect(controller.isLive(token)).toBe(false)
    const next = controller.begin(new AbortController().signal); controller.unmount()
    expect(controller.isLive(next)).toBe(false)
  })

  it("supports Strict Mode setup-cleanup-setup and allows a fresh regenerate", () => {
    const controller = new ReadoutRequestController()
    controller.mount()
    const first = controller.begin(new AbortController().signal)
    expect(controller.isLive(first)).toBe(true)
    controller.unmount()
    expect(controller.isLive(first)).toBe(false)
    controller.mount()
    const second = controller.begin(new AbortController().signal)
    let streamCalls = 0; let saves = 0
    if (controller.isLive(second)) { streamCalls += 1; saves += 1 }
    expect(streamCalls).toBe(1)
    expect(saves).toBe(1)
  })

  it("does not start a stream after the initial digest is invalidated", async () => {
    const controller = new ReadoutRequestController()
    controller.mount()
    const token = controller.begin(new AbortController().signal)
    let releaseDigest!: () => void
    const digest = new Promise<void>((resolve) => { releaseDigest = resolve })
    let streamCalls = 0
    const pending = (async () => {
      await digest
      if (!controller.isLive(token)) return
      streamCalls += 1
    })()

    controller.invalidate()
    releaseDigest()
    await pending

    expect(streamCalls).toBe(0)
  })

  it("runs one mounted request through stream, preview, verified save, and cleanup", async () => {
    const controller = new ReadoutRequestController(); controller.mount()
    const token = controller.begin(new AbortController().signal)
    let streamCalls = 0; let saves = 0; let state = "loading"; const previews: string[] = []
    await runReadoutRequest({
      controller, token,
      requestDigest: async () => "digest-a",
      stream: async (onDelta) => { streamCalls += 1; onDelta("preview"); return "complete" },
      afterDigest: async () => "digest-a",
      inputIsCurrent: () => true,
      save: () => { saves += 1 },
      setPreview: (value) => previews.push(value),
      setState: (value) => { state = value },
    })
    expect(streamCalls).toBe(1)
    expect(saves).toBe(1)
    expect(previews).toEqual(["preview", ""])
    expect(state).toBe("idle")
  })

  it("does not invoke stream or save when initial hydration invalidates the request", async () => {
    const controller = new ReadoutRequestController(); controller.mount()
    const token = controller.begin(new AbortController().signal)
    let release!: () => void; let streamCalls = 0; let saves = 0
    const pending = runReadoutRequest({
      controller, token,
      requestDigest: () => new Promise<string>((resolve) => { release = () => resolve("digest-a") }),
      stream: async () => { streamCalls += 1; return "complete" },
      afterDigest: async () => "digest-a",
      inputIsCurrent: () => true,
      save: () => { saves += 1 },
      setPreview: () => undefined,
      setState: () => undefined,
    })
    controller.invalidate(); release(); await pending
    expect(streamCalls).toBe(0)
    expect(saves).toBe(0)
  })

  it("does not save stale, failed, or aborted replacements", async () => {
    const make = () => { const controller = new ReadoutRequestController(); controller.mount(); return { controller, token: controller.begin(new AbortController().signal) } }
    for (const mode of ["stale", "failed", "aborted"] as const) {
      const { controller, token } = make(); let saves = 0; let state = "loading"
      await runReadoutRequest({
        controller, token,
        requestDigest: async () => "digest-a",
        stream: async () => { if (mode === "aborted") { controller.unmount(); await Promise.resolve() } if (mode === "failed") throw new Error("synthetic"); return "complete" },
        afterDigest: async () => mode === "stale" ? "digest-b" : "digest-a",
        inputIsCurrent: () => mode !== "stale",
        save: () => { saves += 1 },
        setPreview: () => undefined,
        setState: (value) => { state = value },
      })
      expect(saves).toBe(0)
      expect(state).not.toBe("saved")
    }
  })
})
