import { Client } from "pg";
import { supportAiRetentionConfig } from "../lib/server-config";

export const SUPPORT_AI_RETENTION_LIMIT = 25;
/** Both deadlines and missing-ticket content use R6's privileged purge hook.
 * A per-tenant operator connection is required; never elevate tenant_app.
 */
export async function purgeSupportAiTicketContent(tenantId: string): Promise<void> {
  const connectionString = supportAiRetentionConfig().get(tenantId);
  if (!connectionString) return;
  let client: Client | undefined;
  let connected = false;
  try {
    client = new Client({ connectionString, connectionTimeoutMillis: 5000, query_timeout: 6000 });
    await client.connect();
    connected = true;
    await client.query("begin");
    await client.query("set local statement_timeout='5s'");
    await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
    // Operator URLs are trusted configuration, but a shared/misbound database
    // must still fail closed before its unscoped owner function can run.
    await client.query("lock table support.ai_suggestion_requests, support.ai_suggestions in share row exclusive mode");
    const foreign = await client.query("select 1 from support.ai_suggestion_requests where tenant_id<>$1 limit 1", [tenantId]);
    if (foreign.rows.length) throw new Error("tenant mismatch");
    await client.query("select support.purge_ai_suggestion_content()");
    await client.query("commit");
  } catch {
    if (connected) await client!.query("rollback").catch(() => undefined);
    throw new Error("Support AI retention failed");
  } finally { await client?.end().catch(() => undefined); }
}
