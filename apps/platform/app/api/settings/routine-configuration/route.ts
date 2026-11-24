import { settingsResult } from "../../../settings/_lib/form-response";
import { readRoutineMetadata } from "../../../settings/_lib/settings-store";
import { enforceMutationRateLimit } from "../../../../lib/settings-rate-limit";
import { PgAuditStore } from "@opentenant/database";
import type { SupportAction } from "@opentenant/auth";
import { normalizeHost } from "@opentenant/domains";
import { sameOrigin } from "../../../../lib/settings-guard";
import { tenantAdminContext, type TenantAdminContext } from "../../../../lib/tenant-admin";
import { controlPlanePool, withControlPlaneTransaction } from "../../../../lib/control-plane";
import { writeRoutineMetadata } from "../../../../lib/tenant-settings-store";
import { readBoundedForm } from "../../../../lib/bounded-body";

export const runtime = "nodejs";
const RESOURCE_NOT_FOUND = Symbol("resource_not_found");

const AREAS = {
  domain_metadata: {
    action: "domain.metadata.configure",
    keys: { displayLabel: 120, verificationNote: 500 },
  },
  integration_metadata: {
    action: "integration.metadata.configure",
    keys: { displayName: 120, healthNote: 500 },
  },
  module_metadata: {
    action: "module.settings.configure",
    keys: { displayLabel: 120, supportNote: 500 },
  },
} as const satisfies Record<string, { action: SupportAction; keys: Readonly<Record<string, number>> }>;

const CONNECTION_PROVIDERS = new Set(["google", "slack"]);

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const form = await readBoundedForm(req);
  const area = String(form?.get("area") ?? "") as keyof typeof AREAS;
  const policy = Object.hasOwn(AREAS, area) ? AREAS[area] : undefined;
  if (!policy) return new Response("bad area", { status: 400 });
  const gate = await tenantAdminContext(policy.action);
  if (!gate.ok) return gate.response ?? new Response("forbidden", { status: 403 });
  const limited = await enforceMutationRateLimit(req, gate.context); if (limited) return limited;
  let resourceKey = String(form?.get("resourceKey") ?? "").trim();
  if (area === "domain_metadata") {
    const host = normalizeHost(resourceKey);
    if (!host) return new Response("bad resource", { status: 400 });
    resourceKey = host;
  } else if (area === "integration_metadata" && !CONNECTION_PROVIDERS.has(resourceKey)) {
    return new Response("bad resource", { status: 400 });
  } else if (area === "module_metadata" && !/^[a-z][a-z0-9_-]{1,63}$/.test(resourceKey)) {
    return new Response("bad resource", { status: 400 });
  }
  let metadata: Record<string, string>;
  try {
    const encoded = form?.get("metadata");
    const value = encoded === null || encoded === undefined
      ? Object.fromEntries(Object.keys(policy.keys)
          .filter((key) => form?.has(key))
          .map((key) => [key, String(form?.get(key) ?? "")]))
      : JSON.parse(String(encoded)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    metadata = Object.fromEntries(Object.entries(value).map(([key, item]) => {
      const allowedKeys: Readonly<Record<string, number>> = policy.keys;
      const maxLength = allowedKeys[key];
      if (!maxLength || typeof item !== "string" || item.length > maxLength) throw new Error();
      return [key, item];
    }));
    if (Object.keys(metadata).length === 0) throw new Error();
  } catch {
    return new Response("bad metadata", { status: 400 });
  }
  try {
    const changed = await saveRoutineMetadata(gate.context, area, resourceKey, metadata);
    if (req.headers.get("accept")?.includes("application/json")) return settingsResult(req, "/settings", { status: "success", message: changed ? "Settings saved." : "Settings unchanged." });
  } catch (error) {
    if (error === RESOURCE_NOT_FOUND) return new Response("resource not found", { status: 404 });
    return new Response("internal error", { status: 500 });
  }
  return new Response(null, { status: 204 });
}

async function saveRoutineMetadata(context: TenantAdminContext, area: keyof typeof AREAS, resourceKey: string, metadata: Record<string, string>): Promise<boolean> {
  const { tenant, managedSupport, auditActor } = context;
  return withControlPlaneTransaction(async (client) => {
      const current = await readRoutineMetadata(client, area, tenant.tenantId, resourceKey);
      if (!current) throw RESOURCE_NOT_FOUND;
      if (Object.entries(metadata).every(([key, value]) => (current[key] ?? "") === value)) return false;
      const found = await writeRoutineMetadata(client, {
        area,
        tenantId: tenant.tenantId,
        resourceKey,
        metadata,
      });
      if (!found) throw RESOURCE_NOT_FOUND;
      await new PgAuditStore(controlPlanePool()).appendWithClient(client, {
        occurredAt: new Date(),
        actor: auditActor,
        tenantId: tenant.tenantId,
        action: `${area}.changed`,
        subject: resourceKey,
        detail: {
          changedKeys: Object.keys(metadata).join(","),
          supportSessionId: managedSupport?.sessionId ?? null,
          supportReason: managedSupport?.reason ?? null,
        },
      });
      return true;
    });
}
