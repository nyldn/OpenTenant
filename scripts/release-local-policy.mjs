/** This guard runs before every publish, regardless of caller configuration. */
export function localRegistry(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Local publication requires an explicit random loopback HTTP registry");
  }
  return url.origin;
}
