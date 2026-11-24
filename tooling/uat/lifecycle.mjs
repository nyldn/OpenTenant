// Injectable clock/launch boundaries keep TTL proof fast without shortening the
// production eight-hour lifetime or exposing an environment bypass.
export async function supervise({ expiresAt, launch, shutdown, now = Date.now }) {
  const child = launch();
  let stopping;
  const stop = () => { stopping ??= shutdown(); return stopping; };
  const timer = setTimeout(() => { void stop(); }, Math.max(0, expiresAt - now()));
  const term = () => { void stop(); };
  process.once("SIGINT", term); process.once("SIGTERM", term);
  try { await child.exited; }
  finally {
    clearTimeout(timer); process.removeListener("SIGINT", term); process.removeListener("SIGTERM", term); await stop();
  }
}
