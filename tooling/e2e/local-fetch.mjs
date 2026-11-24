import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent, buildConnector, setGlobalDispatcher } from "undici";

// Test process only. Keep the production HTTPS/hostname admission policy intact.
// Trust this run's certificate and connect its exact synthetic hostname locally.
setGlobalDispatcher(new Agent({
  connect(options, callback) {
    if (options.hostname === "module.example.test") {
      const connect = buildConnector({ ca: readFileSync(join(process.env.E2E_DIRECTORY, "cert.pem")) });
      connect({ ...options, hostname: "127.0.0.1", servername: "module.example.test", port: process.env.E2E_UPSTREAM_PORT }, callback);
      return;
    }
    if (!["localhost", "127.0.0.1", "::1"].includes(options.hostname)) {
      callback(new Error("E2E blocked a non-local fetch"), null);
      return;
    }
    buildConnector({})(options, callback);
  },
}));
