import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { images, root, pull, ownedContainer, run, assertReport } from "./docker.mjs";
const start = performance.now();
const container = ownedContainer();
const output = mkdtempSync(join(tmpdir(), "opentenant-microvm-"));
const gateway = "127.0.0.1";
const server = createServer(socket => socket.end("synthetic host listener"));
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, gateway, resolve); });
let passed = false;
try {
  pull(images.node);
  // Pull into MSB_HOME inside the container, not Docker's unrelated image cache.
  run("docker", ["run", "--rm", "--init", "--name", container.name,
    "--label", "opentenant.proof=microvm", "--network", "host", "--device", "/dev/kvm",
    "--mount", `type=bind,src=${root},dst=/repo,readonly`,
    "--mount", `type=bind,src=${output},dst=/proof`,
    "--workdir", "/repo/packages/sandbox", "--env", "MSB_HOME=/tmp/msb-proof",
    "--env", `MICROSANDBOX_TEST_IMAGE=${images.alpine}`, "--env", "MICROSANDBOX_REQUIRED=1",
    "--env", "OPENTENANT_HOST_CANARY=synthetic-host-only-canary",
    "--env", `MICROSANDBOX_PROOF_HOST=${gateway}`,
    "--env", `MICROSANDBOX_PROOF_HOST_PORT=${server.address().port}`,
    images.node, "node", "/repo/tooling/proofs/microvm-container.mjs"], process.env, 600_000);
  assertReport(JSON.parse(readFileSync(join(output, "vitest.json"), "utf8")), 1);
  passed = true;
} finally {
  await container.dispose();
  await new Promise(resolve => server.close(resolve));
  rmSync(output, { recursive: true, force: true });
  console.log(JSON.stringify({ proof: "microvm", passed, totalSeconds: Number(((performance.now() - start) / 1000).toFixed(3)), images }));
}
