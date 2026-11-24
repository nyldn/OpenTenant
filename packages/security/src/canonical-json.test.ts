import { describe, expect, it } from "vitest";
import { canonicalJsonStringify } from "./canonical-json";

describe("canonicalJsonStringify", () => {
  it("is exported from the security package", async () => {
    const security = (await import("./index")) as Record<string, unknown>;

    expect(security.canonicalJsonStringify).toBeTypeOf("function");
  });

  it("sorts object keys recursively while preserving array order", () => {
    expect(
      canonicalJsonStringify({
        z: [{ beta: 2, alpha: 1 }, "last"],
        alpha: { delta: 4, charlie: 3 },
      }),
    ).toBe('{"alpha":{"charlie":3,"delta":4},"z":[{"alpha":1,"beta":2},"last"]}');
  });

  it("produces the same text for equivalent objects with different insertion order", () => {
    const first = { actor: { kind: "user", userId: "user_1" }, detail: { source: "test", ok: true } };
    const reordered = {
      detail: { ok: true, source: "test" },
      actor: { userId: "user_1", kind: "user" },
    };

    expect(canonicalJsonStringify(first)).toBe(canonicalJsonStringify(reordered));
  });

  it("matches JSON.stringify omission and array-null behavior", () => {
    const unsupported = {
      value: undefined,
      callback: () => "ignored",
      marker: Symbol("ignored"),
      kept: true,
    };

    expect(canonicalJsonStringify(unsupported)).toBe('{"kept":true}');
    expect(canonicalJsonStringify([undefined, () => "ignored", Symbol("ignored"), Number.NaN])).toBe(
      "[null,null,null,null]",
    );
    expect(canonicalJsonStringify(undefined)).toBeUndefined();
  });

  it("canonicalizes values returned by toJSON", () => {
    const value = {
      toJSON: () => ({ zulu: 2, alpha: 1 }),
    };

    expect(canonicalJsonStringify({ value })).toBe('{"value":{"alpha":1,"zulu":2}}');
  });

  it("matches JSON.stringify for boxed primitive values", () => {
    expect(canonicalJsonStringify(new String("boxed"))).toBe('"boxed"');
    expect(canonicalJsonStringify(new Number(42))).toBe("42");
    expect(canonicalJsonStringify(new Boolean(false))).toBe("false");
  });

  it("rejects cycles and BigInt values like JSON.stringify", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => canonicalJsonStringify(cyclic)).toThrow(TypeError);
    expect(() => canonicalJsonStringify(1n)).toThrow(TypeError);
  });
});
