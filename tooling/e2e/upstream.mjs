import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { join } from "node:path";

/** Local remote-module fixture shared by browser tests and persistent UAT.
 * @param {string} directory @param {number} port
 */
export async function startModuleStub(directory, port) {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=module.example.test", "-addext", "subjectAltName=DNS:module.example.test",
    "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem")], { stdio: "ignore" });
  const server = createServer({ key: await readFile(join(directory, "key.pem")), cert: await readFile(join(directory, "cert.pem")) }, (req, res) => {
    if (!req.headers["x-opentenant-module-context"] || req.headers.cookie) {
      res.writeHead(400).end("Missing signed context or leaked cookie"); return;
    }
    res.writeHead(200, { "content-type": "text/html", "cache-control": "public, max-age=3600",
      "content-security-policy": "default-src *", "set-cookie": "upstream=blocked; Path=/",
    }).end('<!doctype html><html lang="en"><head><title>Example local module</title></head><body><h1>Example local module</h1></body></html>');
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return { async dispose() {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  } };
}
