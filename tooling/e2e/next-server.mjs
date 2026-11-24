import { createServer } from "node:http";
import { resolve } from "node:path";
import next from "next";

if (process.env.NODE_ENV === "production" || process.env.OPENTENANT_E2E !== "1") {
  throw new Error("E2E server is disabled outside the test launcher");
}

// Use Next's public custom-server API with the real application and config.
// The dev CLI restarts its worker between requests at 80% of the V8 heap cap,
// interrupting browser mutations. V8 still enforces the launcher's heap cap.
const app = next({ dev: true, dir: resolve(import.meta.dirname, "../../apps/platform"), hostname: "localhost", port: Number(process.env.E2E_APP_PORT) });
await app.prepare();
const server = createServer(app.getRequestHandler());
server.on("upgrade", app.getUpgradeHandler());
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(Number(process.env.E2E_APP_PORT), "127.0.0.1", resolve);
});
async function stop() {
  const force = setTimeout(() => process.exit(0), 5000);
  server.closeAllConnections();
  server.close();
  await app.close();
  clearTimeout(force);
  process.exit(0);
}
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });
