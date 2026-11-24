import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AuthorizationContext, AuthorizationPort, TenantRole } from "@opentenant/authz";
import { syncEntitlement, syncMembership } from "@opentenant/authz";

type Client = Pick<PoolClient, "query">;
export type AuthorizationChange =
  | { kind: "membership"; userId: string; role: TenantRole; active: boolean }
  | { kind: "entitlement"; moduleKey: string; enabled: boolean; manifest: AuthorizationContext["manifest"] };
export interface AuthorizationEvent {
  tenant_id: string; sequence: string; kind: AuthorizationChange["kind"]; subject: string;
  version: string; previous_version: string | null; payload: AuthorizationChange; lease_token: string;
}
const validId = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id);

/** Caller MUST use the mutation's transaction. Serializes every tenant's events.
 * Replaying identical desired state neither changes its version nor adds work.
 */
export async function enqueueAuthorizationChange(client: Client, tenantId: string, change: AuthorizationChange, options: { initializeOnly?: boolean } = {}): Promise<void> {
  const subject = change.kind === "membership" ? change.userId : change.moduleKey;
  if (!validId(tenantId) || !validId(subject)) throw new Error("Invalid authorization subject");
  const stream = await client.query<{ next_sequence: string }>(
    `insert into authorization_sync_streams (tenant_id, next_sequence) values ($1, 1)
     on conflict (tenant_id) do update set next_sequence = authorization_sync_streams.next_sequence + 1 returning next_sequence`, [tenantId]);
  const previous = await client.query<{ version: string; unchanged: boolean }>(
    `select version, payload = $4::jsonb as unchanged from authorization_sync_state where tenant_id=$1 and kind=$2 and subject=$3`,
    [tenantId, change.kind, subject, JSON.stringify(change)]);
  if (previous.rows[0]?.unchanged || (options.initializeOnly && previous.rows.length)) return;
  const version = randomUUID();
  await client.query(
    `insert into authorization_sync_state (tenant_id, kind, subject, version, payload) values ($1,$2,$3,$4,$5::jsonb)
     on conflict (tenant_id, kind, subject) do update set version=excluded.version, payload=excluded.payload`,
    [tenantId, change.kind, subject, version, JSON.stringify(change)]);
  await client.query(
    `insert into authorization_outbox (tenant_id, sequence, kind, subject, version, previous_version, payload) values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [tenantId, stream.rows[0].next_sequence, change.kind, subject, version, previous.rows[0]?.version ?? null, JSON.stringify(change)]);
}

/** One head event per tenant. A crashed process becomes reclaimable after 30s.
 * A lease token fences acknowledgement by an expired/replaced worker.
 */
export async function claimAuthorizationEvent(client: Client, tenantId: string): Promise<AuthorizationEvent | null> {
  if (!validId(tenantId)) throw new Error("Invalid authorization tenant");
  const { rows } = await client.query<AuthorizationEvent>(
    `update authorization_outbox set lease_token=$2, lease_until=clock_timestamp()+interval '30 seconds', attempts=attempts+1
     where tenant_id=$1 and completed_at is null and sequence=(select sequence from authorization_outbox where tenant_id=$1 and completed_at is null order by sequence limit 1)
       and available_at<=clock_timestamp() and (lease_until is null or lease_until<=clock_timestamp()) returning *`, [tenantId, randomUUID()]);
  return rows[0] ?? null;
}

export async function deliverAuthorizationEvent(client: Client, port: AuthorizationPort, event: AuthorizationEvent): Promise<boolean> {
  // Suppress obsolete grants, while still revoking their predecessor. Immutable
  // tuple namespaces also fence writes that arrive AFTER a lease expires.
  const current = await client.query<{ current: boolean }>(
    `select version=$4::uuid as current from authorization_sync_state where tenant_id=$1 and kind=$2 and subject=$3`,
    [event.tenant_id, event.kind, event.subject, event.version]);
  const change = event.payload;
  const common = { tenantId: event.tenant_id, version: event.version, ...(event.previous_version ? { previousVersion: event.previous_version } : {}) };
  if (change.kind === "membership") return syncMembership(port, { ...common, ...change, active: change.active && current.rows[0]?.current === true });
  return syncEntitlement(port, { ...common, ...change, enabled: change.enabled && current.rows[0]?.current === true });
}

export async function finishAuthorizationEvent(client: Client, event: AuthorizationEvent, success: boolean): Promise<boolean> {
  const { rows } = await client.query(
    `update authorization_outbox set completed_at=case when $4 then clock_timestamp() else null end,
       available_at=clock_timestamp()+make_interval(secs=>least(300.0, attempts::double precision * attempts)), lease_token=null, lease_until=null,
       last_error=case when $4 then null else 'authorization_sync_failed' end
     where tenant_id=$1 and sequence=$2 and lease_token=$3 and lease_until>clock_timestamp() returning version`,
    [event.tenant_id, event.sequence, event.lease_token, success]);
  if (!rows.length) return false;
  if (success) await client.query(
    `update authorization_sync_state set delivered_version=$4 where tenant_id=$1 and kind=$2 and subject=$3 and version=$4`,
    [event.tenant_id, event.kind, event.subject, event.version]);
  return true;
}

/** A bounded pass. Compose in the worker; no timer or provider is enabled here.
 * Keep acknowledgement and state advancement in a single database transaction.
 */
export async function runAuthorizationOutbox(input: {
  pool: Pick<Pool, "connect">; tenantId: string; port?: AuthorizationPort; limit?: number;
}): Promise<{ delivered: number; failed: number; noop: boolean }> {
  if (!input.port) return { delivered: 0, failed: 0, noop: true };
  let delivered = 0;
  let failed = 0;
  for (let i = 0; i < Math.min(100, Math.max(1, input.limit ?? 20)); i++) {
    const client = await input.pool.connect();
    try {
      const event = await claimAuthorizationEvent(client, input.tenantId);
      if (!event) break;
      let success = false;
      try { success = await deliverAuthorizationEvent(client, input.port, event); } catch { /* normalized below */ }
      await client.query("begin");
      try {
        const acknowledged = await finishAuthorizationEvent(client, event, success);
        await client.query("commit");
        if (!success || !acknowledged) { failed++; break; }
        delivered++;
      } catch (error) { await client.query("rollback"); throw error; }
    } finally { client.release(); }
  }
  return { delivered, failed, noop: false };
}
