#!/usr/bin/env node
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { scaffold } from "./index";
try {
  const { values } = parseArgs({ options: { name: { type: "string" }, identity: { type: "string", default: "local" }, provisioning: { type: "string", default: "postgres" }, tarballs: { type: "string" }, yes: { type: "boolean" } }, allowPositionals: false });
  if (!values.yes || !values.name || !values.tarballs) throw new Error("Usage: create-opentenant --name example-app --identity local|better-auth --provisioning postgres --tarballs /absolute/packed --yes; set POSTGRES_ADMIN_DATABASE_URL to a disposable Postgres server");
  const target = await scaffold({ name: values.name, identity: values.identity as "local" | "better-auth", provisioning: values.provisioning as "postgres", tarballs: values.tarballs });
  execFileSync("pnpm", ["install", "--ignore-scripts", "--registry=https://registry.npmjs.org"], { cwd: target, stdio: "inherit" });
  execFileSync("pnpm", ["setup"], { cwd: target, stdio: "inherit" });
  console.log(`Created ${values.name}. Run pnpm --dir ${values.name} start.`);
} catch (error) { console.error(error instanceof Error && error.message.startsWith("Usage:") ? error.message : "Scaffolding failed. Check the packed packages, target directory and disposable Postgres configuration."); process.exitCode = 1; }
