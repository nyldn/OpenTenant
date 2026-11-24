import { createServer } from "node:net";

/** @param {string | undefined} value */
export function postgresPort(value) {
  if (value === undefined) return freePort();
  const port = Number(value);
  if (!/^\d+$/u.test(value) || !Number.isInteger(port) || port < 1024 || port > 65535 || port === 5432) {
    throw new Error("E2E_POSTGRES_PORT must be an unprivileged port other than 5432");
  }
  return Promise.resolve(port);
}

export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!address || typeof address === "string") throw new Error("No loopback port allocated");
  return address.port === 5432 ? freePort() : address.port;
}

/** Only these host settings may reach local app/test children. @param {NodeJS.ProcessEnv} source */
export function hostEnvironment(source) {
  return Object.fromEntries([
    "PATH", "HOME", "TMPDIR", "TEMP", "SystemRoot", "CI", "TERM",
    "PLAYWRIGHT_BROWSERS_PATH",
  ].flatMap((name) => source[name] === undefined ? [] : [[name, source[name]]]));
}
