// Reviewed ambient-global boundary. Keep operations narrow: never return the
// global object, accept arbitrary property names, or read runtime configuration.
const shared = globalThis as Record<symbol, unknown>;

/** Retain the caller's Symbol.for key across module reloads and bundles. */
function checkedKey(key: symbol): symbol {
  // TypeScript types are erased; reject string keys such as "process" at runtime.
  if (typeof key !== "symbol") throw new TypeError("Process singletons require a Symbol key");
  return key;
}

export function processSingleton<T>(key: symbol, factory: () => T): T {
  checkedKey(key);
  if (!shared[key]) shared[key] = factory();
  return shared[key] as T;
}

/** Remove before asynchronous teardown so a subsequent call creates fresh state. */
export function takeProcessSingleton<T>(key: symbol): T | undefined {
  checkedKey(key);
  const value = shared[key] as T | undefined;
  delete shared[key];
  return value;
}

export function browserStorage(): Storage | undefined {
  try {
    return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function browserLocation(): Pick<Location, "hostname" | "search" | "origin"> | undefined {
  if (typeof window === "undefined") return undefined;
  const { hostname, search, origin } = window.location;
  return { hostname, search, origin };
}

export function navigateBrowser(url: string): void { window.location.assign(url); }
export function confirmBrowser(message: string): boolean { return window.confirm(message); }
export function dispatchBrowserEvent(event: Event): boolean { return window.dispatchEvent(event); }
export function browserWidth(): number | undefined { return typeof window === "undefined" ? undefined : window.innerWidth; }
export function browserMatchMedia(query: string): MediaQueryList { return window.matchMedia(query); }

export function listenBrowserEvent<K extends keyof WindowEventMap>(type: K, listener: (event: WindowEventMap[K]) => void): () => void;
export function listenBrowserEvent(type: string, listener: EventListener): () => void;
export function listenBrowserEvent(type: string, listener: EventListener): () => void {
  window.addEventListener(type, listener);
  return () => window.removeEventListener(type, listener);
}
