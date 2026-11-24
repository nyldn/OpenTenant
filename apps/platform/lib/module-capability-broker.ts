import type { TenantId } from "@opentenant/auth";
import { PgModuleCapabilityStore } from "@opentenant/database";
import type { ModuleContextClaims } from "@opentenant/security";
import { helpdeskSource } from "../opentenant-modules";
const { listTicketSummaries } = helpdeskSource;
type SupportTicketSummary = Awaited<ReturnType<typeof listTicketSummaries>>[number];
import { resolveTenantDb, type TenantDbHandle } from "./tenant-db";
import { controlPlanePool } from "./control-plane";

let store: PgModuleCapabilityStore | null = null;

function capabilityStore(): PgModuleCapabilityStore {
  if (!store) {
    store = new PgModuleCapabilityStore(controlPlanePool());
  }
  return store;
}

function resultSize(count: number): "none" | "one" | "small" | "bounded" {
  if (count === 0) return "none";
  if (count === 1) return "one";
  if (count <= 10) return "small";
  return "bounded";
}

/** Fixed broker operation; callers cannot select SQL, fields, tenant, capability, or limit. */
export async function brokerSupportTicketSummaries(
  claims: ModuleContextClaims,
  correlationId: string,
): Promise<
  | { readonly allowed: true; readonly value: SupportTicketSummary[] }
  | { readonly allowed: false; readonly reason: string }
> {
  // Resolved outside the authorization transaction (see resolveTenantDb). A
  // resolution failure surfaces inside the operation so it is still audited
  // as a capability error.
  const tenantDb: TenantDbHandle = await resolveTenantDb(claims.tenantId as TenantId).catch(
    (error: unknown): TenantDbHandle => ({
      withClient: async () => {
        throw error;
      },
    }),
  );
  return capabilityStore().withAuthorizedCapability({
    tenantId: claims.tenantId as TenantId,
    moduleKey: claims.moduleKey,
    moduleVersion: claims.moduleVersion,
    capability: "support.ticket.read",
    runtimePermissions: claims.permissions,
    identityBacked: claims.userId !== null,
    actor: claims.userId === null
      ? { kind: "system", job: "module-capability-broker" }
      : { kind: "user", userId: claims.userId },
    correlationId,
  }, async () => {
    const value = await tenantDb.withClient(async (client) => {
      await client.query("set local statement_timeout = '4500ms'");
      await client.query("set local idle_in_transaction_session_timeout = '4500ms'");
      return listTicketSummaries(client, claims.tenantId);
    });
    return {
      value,
      resultCount: value.length,
      resultSize: resultSize(value.length),
    };
  });
}
