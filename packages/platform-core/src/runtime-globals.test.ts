import { afterEach, expect, it, vi } from "vitest";
import { browserLocation, browserStorage, listenBrowserEvent, processSingleton, takeProcessSingleton } from "./runtime-globals";

afterEach(() => vi.unstubAllGlobals());

it("shares existing symbol-keyed state across module reloads", async () => {
  const key = Symbol.for("opentenant.test.runtime-singleton");
  const state = { pool: "synthetic" };
  const factory = vi.fn(() => state);
  try {
    expect(processSingleton(key, factory)).toBe(state);
    vi.resetModules();
    const reloaded = await import("./runtime-globals");
    expect(reloaded.processSingleton(key, factory)).toBe(state);
    expect(factory).toHaveBeenCalledTimes(1);
  } finally { takeProcessSingleton(key); }
});

it("does not cache a failed factory", () => {
  const key = Symbol("failed factory");
  expect(() => processSingleton(key, () => { throw new Error("unavailable"); })).toThrow("unavailable");
  expect(processSingleton(key, () => "recovered")).toBe("recovered");
  takeProcessSingleton(key);
});

it("removes state before teardown and keeps unrelated keys separate", () => {
  const first = Symbol("pool");
  const second = Symbol("pool");
  const state = processSingleton(first, () => ({ end: vi.fn() }));
  expect(processSingleton(second, () => "other")).toBe("other");
  expect(takeProcessSingleton(first)).toBe(state);
  expect(takeProcessSingleton(first)).toBeUndefined();
  expect(processSingleton(first, () => "replacement")).toBe("replacement");
  expect(takeProcessSingleton(second)).toBe("other");
  takeProcessSingleton(first);
});

it("preserves optional storage including a throwing browser security getter", () => {
  vi.stubGlobal("localStorage", undefined);
  expect(browserStorage()).toBeUndefined();
  const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
  vi.stubGlobal("localStorage", storage);
  expect(browserStorage()).toBe(storage);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("denied"); } });
  expect(browserStorage()).toBeUndefined();
});

it("returns a location snapshot only in the browser", () => {
  vi.stubGlobal("window", undefined);
  expect(browserLocation()).toBeUndefined();
  const location = { hostname: "tenant.example.test", search: "?brand=tenant", origin: "https://tenant.example.test", assign: vi.fn() };
  vi.stubGlobal("window", { location });
  expect(browserLocation()).toEqual({ hostname: location.hostname, search: location.search, origin: location.origin });
  expect(browserLocation()).not.toBe(location);
});

it("removes the same browser event listener when the consumer unmounts", () => {
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  vi.stubGlobal("window", { addEventListener, removeEventListener });
  const listener = vi.fn();
  const cleanup = listenBrowserEvent("keydown", listener);
  expect(addEventListener).toHaveBeenCalledWith("keydown", listener);
  cleanup();
  expect(removeEventListener).toHaveBeenCalledWith("keydown", listener);
});
