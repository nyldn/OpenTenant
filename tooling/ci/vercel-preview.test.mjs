import assert from "node:assert/strict";
import { test } from "node:test";
import { runVercel } from "./vercel-preview.mjs";

const deploy = ["deploy", "--name", "example-platform", "--repo", "12345", "--ref", "reviewed", "--sha", "a".repeat(40)];
const apply = ["--apply", "--project", "prj_example"];
const env = { VERCEL_API_KEY: "synthetic-test-token", VERCEL_TEAM_ID: "team_example" };
const log = () => {};

test("dry run is default and explicit; never fetches even with credentials", async () => {
  const fetchImpl = async () => { throw new Error("must not fetch"); };
  for (const args of [deploy, [...deploy, "--dry-run"], ["env-check", "--identity", "workos"], ["domain-add", "--domain", "*.example.test"]]) {
    assert.equal((await runVercel(args, { env, fetchImpl, log })).dryRun, true);
  }
});

test("apply requires command-line project and token, rejects conflicting modes", async () => {
  const fetchImpl = async () => { assert.fail("must not fetch"); };
  await assert.rejects(runVercel([...deploy, "--apply"], { env: { ...env, VERCEL_PROJECT_ID: "ignored" }, fetchImpl, log }), /--project/u);
  await assert.rejects(runVercel([...deploy, ...apply], { env: {}, fetchImpl, log }), /VERCEL_API_KEY/u);
  await assert.rejects(runVercel([...deploy, ...apply, "--dry-run"], { env, fetchImpl, log }), /Choose/u);
  await assert.rejects(runVercel(["domain-add", "--domain", "example.test", ...apply], { env, fetchImpl, log }), /wildcard/u);
});

test("wildcard domain add uses explicit project and team with no response logging", async () => {
  const lines = [];
  await runVercel(["domain-add", "--domain", "*.example.test", ...apply], { env, log: (line) => lines.push(line), fetchImpl: async (url, init) => {
    assert.equal(String(url), "https://api.vercel.com/v10/projects/prj_example/domains?teamId=team_example");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { name: "*.example.test" });
    assert.equal(init?.headers?.["Authorization"], `Bearer ${env.VERCEL_API_KEY}`);
    assert.equal(init?.redirect, "error");
    return Response.json({ value: "never-log-this" });
  } });
  assert.deepEqual(lines, ["domain-add: accepted"]);
});

test("env check uses names and preview target only; withholds values", async () => {
  const lines = [];
  const keys = ["IDENTITY_PROVIDER", "CONTROL_PLANE_DATABASE_URL", "PLATFORM_PUBLIC_ORIGIN", "MODULE_ACCESS_SECRET", "CONNECTIONS_STATE_SECRET", "WORKOS_API_KEY", "WORKOS_CLIENT_ID", "WORKOS_COOKIE_PASSWORD", "WORKOS_REDIRECT_URI"];
  const result = await runVercel(["env-check", "--identity", "workos", "--ref", "reviewed", ...apply], { env, log: (line) => lines.push(line), fetchImpl: async (url) => {
    assert.equal(new URL(url).searchParams.get("decrypt"), "false");
    assert.equal(new URL(url).searchParams.get("gitBranch"), "reviewed");
    return Response.json({ envs: keys.map((key) => ({ key, value: "never-log-this", target: ["preview"] })) });
  } });
  assert.deepEqual(result.names, keys);
  assert.equal(lines.some((line) => line.includes("never-log-this")), false);
  assert.ok(lines.every((line) => line.endsWith(": present")));
  for (const entry of [{ key: "IDENTITY_PROVIDER", target: ["production"] }, { key: "IDENTITY_PROVIDER", target: ["preview"], gitBranch: "different" }]) {
    await assert.rejects(runVercel(["env-check", "--identity", "workos", ...apply], { env, log, fetchImpl: async () => Response.json({ envs: [entry] }) }), /missing/u);
  }
});

test("deploy triggers git preview with root settings and no promotion", async () => {
  await runVercel([...deploy, ...apply], { env, log, fetchImpl: async (url, init) => {
    assert.equal(new URL(url).pathname, "/v13/deployments");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.project, "prj_example");
    assert.deepEqual(body.gitSource, { type: "github", repoId: "12345", ref: "reviewed", sha: "a".repeat(40) });
    assert.deepEqual(body.projectSettings, { rootDirectory: "apps/platform", buildCommand: "pnpm --dir ../.. turbo build --filter=@opentenant/platform" });
    assert.equal(body.target, undefined);
    return Response.json({ secret: "never-log-this" });
  } });
});

test("API and transport errors never expose response or token", async () => {
  for (const fetchImpl of [async () => new Response("never-log-this", { status: 403 }), async () => { throw new Error(env.VERCEL_API_KEY); }]) {
    await assert.rejects(runVercel([...deploy, ...apply], { env, log, fetchImpl }), (error) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /never-log-this|synthetic-test-token/u);
      return true;
    });
  }
});
