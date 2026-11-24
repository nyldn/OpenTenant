import { PgAuditStore } from "@opentenant/database";
import type { Pool } from "pg";

type AuditActor = Parameters<PgAuditStore["appendWithClient"]>[1]["actor"];

export function normalizeBrandSeedSource(input: string): string | null {
  if (!input || input.length > 2048) return null;
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function queueBrandSeed(
  db: Pool,
  tenantId: string,
  sourceUrl: string,
  actor: AuditActor,
): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const request = await client.query<{ request_id: string }>(
      `insert into brand_seed_requests (tenant_id, source_url)
       values ($1, $2)
       on conflict (tenant_id, source_url) where status <> 'discarded' do update
         set status = case
               when brand_seed_requests.status = 'failed' then 'pending'
               else brand_seed_requests.status
             end,
             updated_at = now()
       returning request_id`,
      [tenantId, sourceUrl],
    );
    const requestId = request.rows[0]?.request_id;
    if (!requestId) throw new Error("Brand seed request was not persisted");
    await client.query(
      `insert into brand_proposals (request_id, tenant_id, proposed_values)
       values ($1, $2, '{}')
       on conflict (request_id) do nothing`,
      [requestId, tenantId],
    );
    await new PgAuditStore(db).appendWithClient(client, {
      occurredAt: new Date(),
      actor,
      tenantId,
      action: "brand.seed.requested",
      subject: requestId,
      detail: { sourceOrigin: new URL(sourceUrl).origin },
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
