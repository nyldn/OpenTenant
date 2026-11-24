import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";

const commonNames = ["IDENTITY_PROVIDER", "CONTROL_PLANE_DATABASE_URL", "PLATFORM_PUBLIC_ORIGIN", "MODULE_ACCESS_SECRET", "CONNECTIONS_STATE_SECRET"];
const identityNames = {
  workos: ["WORKOS_API_KEY", "WORKOS_CLIENT_ID", "WORKOS_COOKIE_PASSWORD", "WORKOS_REDIRECT_URI"],
  clerk: ["CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "CLERK_JWT_ISSUER", "CLERK_AUTHORIZED_PARTIES", "CLERK_JWT_AUDIENCE"],
};

/** @param {string[]} args */
function options(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    "dry-run": { type: "boolean" }, apply: { type: "boolean" },
    project: { type: "string" }, team: { type: "string" }, domain: { type: "string" },
    identity: { type: "string" }, name: { type: "string" }, repo: { type: "string" },
    ref: { type: "string" }, sha: { type: "string" },
  } });
  if (positionals.length !== 1 || !["domain-add", "env-check", "deploy"].includes(positionals[0])) {
    throw new Error("Choose domain-add, env-check or deploy");
  }
  if (values.apply && values["dry-run"]) throw new Error("Choose --dry-run or --apply");
  if (values.apply && !values.project) throw new Error("--apply requires --project on the command line");
  if (values.project && !/^[A-Za-z0-9_-]+$/u.test(values.project)) throw new Error("Invalid --project");
  return { ...values, command: positionals[0] };
}

/** @param {ReturnType<typeof options>} opts @param {string} buildCommand */
function requestPlan(opts, buildCommand) {
  let pathname;
  let body;
  let requiredNames = commonNames;
  const project = encodeURIComponent(opts.project ?? "PROJECT_REQUIRED");
  if (opts.command === "domain-add") {
    if (!opts.domain || !/^\*\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(opts.domain)) {
      throw new Error("--domain must be a wildcard DNS name");
    }
    pathname = `/v10/projects/${project}/domains`;
    body = { name: opts.domain };
  } else if (opts.command === "env-check") {
    if (opts.identity !== "workos" && opts.identity !== "clerk") throw new Error("--identity must be workos or clerk");
    requiredNames = [...commonNames, ...identityNames[opts.identity]];
    pathname = `/v10/projects/${project}/env`;
  } else {
    if (!opts.name || !/^[a-z0-9][a-z0-9-]{0,99}$/u.test(opts.name) || !opts.repo || !/^\d+$/u.test(opts.repo) || !opts.ref || !opts.sha || !/^[a-f0-9]{40}$/u.test(opts.sha)) {
      throw new Error("deploy requires --name, --repo, --ref and a full --sha");
    }
    pathname = "/v13/deployments";
    body = {
      name: opts.name, project: opts.project,
      gitSource: { type: "github", repoId: opts.repo, ref: opts.ref, sha: opts.sha },
      projectSettings: { rootDirectory: "apps/platform", buildCommand: buildCommand },
    };
  }
  return { pathname, body, requiredNames };
}

/** @param {unknown} data @param {string | undefined} ref @param {string[]} requiredNames */
function missingPreviewNames(data, ref, requiredNames) {
  if (!data || typeof data !== "object" || !("envs" in data) || !Array.isArray(data.envs)) {
    throw new Error("Invalid Vercel environment response");
  }
  const names = new Set(data.envs.filter((entry) => entry.target?.includes("preview") && (!entry.gitBranch || entry.gitBranch === ref)).map((entry) => entry.key));
  return requiredNames.filter((name) => !names.has(name));
}

/**
 * No fetch runs in dry-run mode, including env-check. Never return provider
 * bodies, env values or transport exceptions to the caller or command log.
 * @param {string[]} args
 */
export async function runVercel(args, { env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  const opts = options(args);
  const settings = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));
  const { pathname, body, requiredNames } = requestPlan(opts, settings.buildCommand);
  const method = body ? "POST" : "GET";
  if (!opts.apply) {
    log(`Dry run: ${opts.command}; ${method}; no network request. Apply requires --apply --project <id>.`);
    return { dryRun: true, command: opts.command };
  }
  const token = env.VERCEL_API_KEY;
  if (!token) throw new Error("VERCEL_API_KEY is required for --apply");
  const url = new URL(pathname, "https://api.vercel.com");
  const team = opts.team ?? env.VERCEL_TEAM_ID;
  if (team) url.searchParams.set("teamId", team);
  if (opts.command === "env-check") {
    url.searchParams.set("decrypt", "false");
    if (opts.ref) url.searchParams.set("gitBranch", opts.ref);
  }
  let response;
  try {
    response = await fetchImpl(url, {
      method, redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error("Vercel request failed; transport details withheld");
  }
  if (!response.ok) throw new Error(`Vercel request failed with HTTP ${response.status}; response withheld`);
  if (opts.command === "env-check") {
    let data;
    try { data = await response.json(); } catch { throw new Error("Invalid Vercel environment response"); }
    const missing = missingPreviewNames(data, opts.ref, requiredNames);
    for (const name of requiredNames) log(`${name}: ${missing.includes(name) ? "missing" : "present"}`);
    if (missing.length) throw new Error("Required preview environment variable names are missing");
    return { names: requiredNames };
  }
  // Domain challenges and deployment metadata can be read later through the
  // approved operator workflow. Raw API responses must never reach logs.
  log(`${opts.command}: accepted`);
  return { accepted: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await runVercel(process.argv.slice(2)); }
  catch { console.error("Vercel operation failed. Check arguments, required names and project access; details withheld."); process.exitCode = 1; }
}
