import { configurationEnvironment } from "./server-config";
import { homedir } from "node:os";
import { resolve, join } from "node:path";

/** Worker and operator-process configuration. No browser access. */
export function tenantWorkerConfig(env: NodeJS.ProcessEnv = configurationEnvironment()) {
  const retentionHours = Number(env.TENANT_DELETE_RETENTION_HOURS ?? 24 * 30);
  if (!Number.isFinite(retentionHours) || retentionHours < 1 || retentionHours > 87600) throw new Error("Invalid TENANT_DELETE_RETENTION_HOURS");
  return {
    retentionHours,
    operatorUserId: env.OPENTENANT_OPERATOR_USER_ID,
    exportDirectory: resolve(env.TENANT_EXPORT_DIRECTORY ?? join(homedir(), ".local/share/opentenant/tenant-exports")),
    inviteDirectory: resolve(env.TENANT_OWNER_INVITE_DIRECTORY ?? join(homedir(), ".local/share/opentenant/owner-invites")),
  };
}
