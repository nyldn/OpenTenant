import { proveScaffoldStart } from "./scaffold-start-check.mjs";
// Runs inside a fresh node:22 container with only packed artifacts mounted.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import assert from "node:assert/strict";
const run = (cmd, args, cwd = "/work") => execFileSync(cmd, args, { cwd, stdio: "inherit", env: process.env });
run("npm", ["install", "--global", "pnpm@11.13.1", "--registry=https://registry.npmjs.org"]);
const cli = readdirSync("/packs").find(file => file.startsWith("create-opentenant-"));
assert(cli, "CLI tarball missing");
run("tar", ["-xzf", `/packs/${cli}`, "-C", "/work"]);
run("node", ["/work/package/dist/cli.js", "--name", "example-app", "--identity", process.env.IDENTITY_PROVIDER ?? "local", "--provisioning", "postgres", "--tarballs", "/packs", "--yes"]);
await proveScaffoldStart("/work/example-app");
