import { installedModules } from "../opentenant-modules";
import { processSingleton, takeProcessSingleton } from "@opentenant/platform-core/runtime-globals";
import "server-only";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { RateLimiterPostgres, RateLimiterRes } from "rate-limiter-flexible";
import { tenantApiLifecycleResponse } from "./settings-guard";
import { serverConfig } from "./server-config";

  // module-audit-exclude: installation operator support budget exists without any installed module.
export type RouteClass = "settings" | "members" | "identity-portal" | "support" | "brand-proposal" | "tenant-creation" | "passcode" | "module-access";
export interface RateLimitScope { tenantId: string; userId: string; routeClass: RouteClass }
interface Consumer { consume(key: string): Promise<unknown> }
export const RATE_LIMITS: Readonly<Record<RouteClass, number>> = {
  settings: 60, members: 20, "identity-portal": 10, support: 60,
  "brand-proposal": 20, "tenant-creation": 5, passcode: 10, "module-access": 30,
};

export function routeClassForPath(path: string): RouteClass | null {
  if (path === "/api/settings/members") return "members";
  if (path === "/api/settings/identity-portal") return "identity-portal";
  if (path.startsWith("/api/settings/")) return "settings";
  // module-audit-exclude: installation operator support budget exists without any installed module.
  if (path.startsWith("/api/admin/support-") || path.startsWith("/api/module-broker/")) return "support";
  const moduleRoute = installedModules.apiRoute(path);
  if (moduleRoute) return moduleRoute.rateLimitClass ?? "module-access";
  if (path === "/api/admin/brand-proposals") return "brand-proposal";
  if (path === "/api/admin/tenants") return "tenant-creation";
  if (path.startsWith("/api/module-access/")) return "passcode";
  if (path.startsWith("/m/")) return "module-access";
  return null;
}

export function rateLimitKey(scope: RateLimitScope): string {
  return createHash("sha256").update(JSON.stringify([scope.tenantId, scope.userId, scope.routeClass])).digest("hex");
}

export function createRateLimitGate(consumer: Consumer) {
  return async (scope: RateLimitScope): Promise<Response | null> => {
    try { await consumer.consume(rateLimitKey(scope)); return null; }
    catch (error) {
      if (error instanceof RateLimiterRes || (typeof error === "object" && error !== null && "msBeforeNext" in error && typeof error.msBeforeNext === "number" && Number.isFinite(error.msBeforeNext))) {
        const retry = Math.max(1, Math.ceil(Number(error.msBeforeNext) / 1000));
        return new Response("rate limited", { status: 429, headers: { "Retry-After": String(retry), "Cache-Control": "no-store" } });
      }
      return new Response("service unavailable", { status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" } });
    }
  };
}

const STATE = Symbol.for("opentenant.rate-limit");
interface LimiterState { pool: Pool; limits: Map<RouteClass | "ip", RateLimiterPostgres> }
/** A single extra connection to the same control-plane DB. Never borrows from the 5-client app pool. */
function consumer(routeClass: RouteClass, ip = false): RateLimiterPostgres {
  const state = processSingleton<LimiterState>(STATE, () => {
    const connectionString = serverConfig().CONTROL_PLANE_DATABASE_URL;
    if (!connectionString) throw new Error("Rate limiter database is not configured");
    const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 1000, idleTimeoutMillis: 30_000, query_timeout: 1000 });
    pool.on("error", () => { /* Never emit driver errors containing connection details. */ });
    return { pool, limits: new Map() };
  });
  const key = ip ? "ip" : routeClass;
  let limiter = state.limits.get(key);
  if (!limiter) {
    limiter = new RateLimiterPostgres({ storeClient: state.pool, tableName: "request_rate_limits", tableCreated: true, keyPrefix: ip ? "ip" : routeClass, points: ip ? 5 : RATE_LIMITS[routeClass], duration: 60 });
    state.limits.set(key, limiter);
  }
  return limiter;
}

/** Only a proxy that strips and overwrites this configured header may supply an IP. */
export function trustedRateLimitIp(req: Request): string {
  const name = serverConfig().OPENTENANT_TRUSTED_IP_HEADER;
  if (!name) return "unattributed";
  const value = req.headers.get(name)?.trim();
  // Never accept forwarding lists. Bad/missing input shares a strict bucket.
  return value && value.length <= 45 && isIP(value) !== 0 ? value : "unattributed";
}

/** Scope must come from a verified gate, never a submitted tenant/user field. */
export async function enforceRateLimit(req: Request, scope: RateLimitScope): Promise<Response | null> {
  try {
    if (scope.tenantId !== "installation") {
      const lifecycleResponse = await tenantApiLifecycleResponse();
      if (lifecycleResponse) return lifecycleResponse;
    }
    if (scope.routeClass === "passcode" || scope.routeClass === "module-access") {
      const ipScope = { tenantId: scope.tenantId, userId: trustedRateLimitIp(req), routeClass: scope.routeClass };
      const limited = await createRateLimitGate(consumer(scope.routeClass, true))(ipScope);
      if (limited) return limited;
    }
    return await createRateLimitGate(consumer(scope.routeClass))(scope);
  } catch {
    return new Response("service unavailable", { status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" } });
  }
}


/** Process shutdown/test teardown. Call only after serving has stopped. */
export async function closeRateLimitPool(): Promise<void> {
  const state = takeProcessSingleton<LimiterState>(STATE);
  await state?.pool.end();
}
