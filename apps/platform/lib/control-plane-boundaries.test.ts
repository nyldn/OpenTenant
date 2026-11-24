import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

function productionFiles(directory: string): string[] {
  return readdirSync(resolve(process.cwd(), directory), { recursive: true, encoding: "utf8" })
    .filter((file) => /\.(?:ts|tsx)$/.test(file) && !/\.test\.(?:ts|tsx)$/.test(file))
    .map((file) => `${directory}/${file}`);
}

describe("control-plane pool boundaries", () => {
  it("keeps only the tenant RLS and provisioning one-shot pools separate", () => {
    const tenantDb = source("lib/tenant-db.ts");
    const provisioning = readFileSync(resolve(process.cwd(), "../../tooling/provisioning/src/tenant-database.ts"), "utf8");

    expect(tenantDb).toContain("(connectionString) => trackedPool(connectionString, 5)");
    expect(tenantDb).toContain("controlPlanePool().query");
    expect(provisioning).toContain("new Pool({ connectionString: connectionUri, max: 1 })");
    expect(source("lib/provisioning.ts")).toContain("const db = controlPlanePool()");
  });

  it("does not construct any other production platform pool", () => {
    const files = ["app", "lib", "workflows"].flatMap(productionFiles);
    const constructors = files
      .filter((file) => source(file).includes("new Pool("))
      .sort();

    expect(constructors).toEqual([
      "lib/control-plane.ts",
      "lib/rate-limit.ts",
      "lib/tenant-db.ts",
    ]);
  });

  it("request-scopes the stable currentTenant and currentSession entry points with React cache", () => {
    const tenant = source("lib/tenant.ts");
    const session = source("lib/session.ts");

    expect(tenant).toContain("const resolveCurrentTenant = cache(async ()");
    expect(tenant).toContain("export function currentTenant(): Promise<ResolvedTenant | null>");
    expect(session).toContain("const resolveCurrentSession = cache(async (");
    expect(session).toContain("export function currentSession(");
    expect(tenant).not.toMatch(/unstable_cache|["']use cache["']/);
    expect(session).not.toMatch(/unstable_cache|["']use cache["']/);
  });

  it("keeps Route Handler correctness independent from request memoization", () => {
    for (const route of productionFiles("app").filter((file) => file.endsWith("/route.ts"))) {
      const routeSource = source(route);
      expect(routeSource, route).not.toMatch(/\b(?:cache|unstable_cache)\s*\(/);
      expect(routeSource, route).not.toMatch(/["']use cache["']/);
      expect(routeSource.match(/\bcurrentTenant\(/g)?.length ?? 0, route).toBeLessThanOrEqual(1);
      expect(routeSource.match(/\bcurrentSession\(/g)?.length ?? 0, route).toBeLessThanOrEqual(1);
    }
  });

  it("keeps SQL and transaction mechanics out of production routes and pages", () => {
    for (const file of productionFiles("app").filter((candidate) =>
      candidate.endsWith("/route.ts") || candidate.endsWith("/page.tsx")
    )) {
      const routeSource = source(file);
      expect(routeSource, file).not.toMatch(/\b(?:select|insert\s+into|update|delete\s+from)\b[\s\S]{0,120}\$\d/i);
      expect(routeSource, file).not.toMatch(/\.query\s*\(/);
      expect(routeSource, file).not.toMatch(/\.connect\s*\(/);
    }
  });

  it("provides the shared hardened same-origin check to installed modules", () => {
    expect(source("lib/module-services.ts")).toContain('sameOrigin');
    expect(source("lib/module-services.ts")).toContain('from "./settings-guard"');
  });

  it("derives the tenant-admin audit actor once", () => {
    const tenantAdmin = source("lib/tenant-admin.ts");
    expect(tenantAdmin).toContain("auditActor: AuditActor");
    expect(tenantAdmin).toContain("auditActor(session, false)");
    expect(tenantAdmin).toContain("auditActor(support.context.operator, true)");
  });
});
