import { parseArgs } from "node:util";
import { controlPlanePool } from "../lib/control-plane";
import { tenantWorkerConfig } from "../lib/tenant-worker-config";
import { issueTenantOwnerInvite } from "../lib/tenant-owner-invite";

const { values } = parseArgs({ options: { tenant: { type: "string" }, email: { type: "string" }, operator: { type: "string" } } });
const db = controlPlanePool();
try {
  const operatorId = values.operator ?? tenantWorkerConfig().operatorUserId;
  if (!values.tenant || !values.email || !operatorId) throw new Error("Arguments required");
  const operator = await db.query(`select user_id from platform_users where user_id=$1 and is_platform_admin=true`, [operatorId]);
  const tenant = await db.query<{ tenant_id: string }>(`select tenant_id from tenants where slug=$1 and status='active'`, [values.tenant]);
  if (!operator.rows[0] || !tenant.rows[0]) throw new Error("Unknown operator or tenant");
  const result = await issueTenantOwnerInvite(tenant.rows[0].tenant_id, values.email, { kind: "installation_owner", userId: operatorId }, { reissue: true });
  process.stdout.write(`Owner claim delivery file: ${result.file}\n`);
} catch {
  process.stderr.write("Owner invite failed. Use --tenant <slug> --email <email> --operator <installation-owner-id>.\n");
  process.exitCode = 1;
} finally { await db.end(); }
