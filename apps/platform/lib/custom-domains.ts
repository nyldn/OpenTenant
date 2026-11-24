import "server-only";
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { customDomainHost } from "@opentenant/domains";
import { evaluateDomainVerification, hashChallenge } from "@opentenant/domains/verification";
import { PgAuditStore } from "@opentenant/database";
import type { AuditActor } from "@opentenant/security";
import { controlPlanePool, withControlPlaneTransaction } from "./control-plane";
import { serverConfig } from "./server-config";

export type TxtResolver = (record: string) => Promise<string[][]>;
type Database = Pick<Pool, "connect">;

function checkedHost(raw: string): string {
  const config = serverConfig();
  const reserved = [config.OPENTENANT_TENANT_BASE_DOMAIN];
  if (config.PLATFORM_ADMIN_HOST) reserved.push(config.PLATFORM_ADMIN_HOST);
  if (config.PLATFORM_PUBLIC_ORIGIN) reserved.push(new URL(config.PLATFORM_PUBLIC_ORIGIN).hostname);
  const host = customDomainHost(raw, reserved);
  if (!host) throw new Error("Invalid custom subdomain");
  return host;
}

export async function addCustomDomain(tenantId: string, raw: string, actor: AuditActor, pool: Database = controlPlanePool()) {
  const host = checkedHost(raw);
  const token = `opentenant-${randomBytes(32).toString("hex")}`;
  await withControlPlaneTransaction(async (client) => {
    // Serialize namespace claims, including parent/child overlaps across tenants.
    await client.query("select pg_advisory_xact_lock(19486, 48)");
    const existing = await client.query(
      `select host from domains where host = $1 or
       (kind = 'custom' and (right(host, length($1) + 1) = '.' || $1 or right($1, length(host) + 1) = '.' || host))`, [host],
    );
    if (existing.rows.length) throw new Error("Domain unavailable");
    await client.query(
      `insert into domains (host, tenant_id, kind, verification, active, challenge_hash, challenge_expires_at, challenge_record)
       values ($1, $2, 'custom', 'pending', false, $3, now() + interval '24 hours', '_opentenant-challenge.' || $1)`,
      [host, tenantId, hashChallenge(token)],
    );
    await new PgAuditStore(pool as Pool).appendWithClient(client, {
      occurredAt: new Date(), actor, tenantId, action: "domain.added", subject: host, detail: { kind: "custom" },
    });
  }, pool);
  return { host, record: `_opentenant-challenge.${host}`, token };
}

export async function verifyCustomDomain(tenantId: string, raw: string, actor: AuditActor, resolveTxt: TxtResolver, pool: Database = controlPlanePool()) {
  const host = checkedHost(raw);
  // Bind DNS to a tenant-owned challenge before resolving. A reissue while DNS
  // is in flight makes the result stale, even if DNS now contains the new token.
  const snapshot = await withControlPlaneTransaction(async (client) => {
    const { rows } = await client.query<{ challenge_hash: string; challenge_record: string; challenge_expires_at: Date }>(
      "select challenge_hash, challenge_record, challenge_expires_at from domains where host = $1 and tenant_id = $2 and kind = 'custom'", [host, tenantId],
    );
    if (!rows[0]?.challenge_hash) throw new Error("Domain unavailable");
    return rows[0];
  }, pool);
  let records: string[][] = [];
  try { records = await resolveTxt(snapshot.challenge_record ?? `_opentenant-challenge.${host}`); } catch { /* fail closed */ }
  return withControlPlaneTransaction(async (client) => {
    const { rows } = await client.query<{ challenge_hash: string; challenge_expires_at: Date; verified_at: Date | null }>(
      `select challenge_hash, challenge_expires_at, verified_at from domains
       where host = $1 and tenant_id = $2 and kind = 'custom' for update`, [host, tenantId],
    );
    const row = rows[0];
    if (!row?.challenge_hash || !row.challenge_expires_at) throw new Error("Domain unavailable");
    if (row.challenge_hash !== snapshot.challenge_hash || row.challenge_expires_at.getTime() !== snapshot.challenge_expires_at.getTime()) throw new Error("Challenge changed. Retry verification.");
    const now = new Date();
    const result = evaluateDomainVerification({ hash: row.challenge_hash, expiresAt: row.challenge_expires_at, previouslyVerified: row.verified_at !== null }, records, now);
    await client.query(
      `update domains set verification = $3, active = $4,
       verified_at = case when $4 then $5 else verified_at end,
       verification_valid_until = $6, next_check_at = $7, recheck_reason = null where host = $1 and tenant_id = $2 and kind = 'custom'`,
      [host, tenantId, result.verification, result.active, now, result.validUntil, result.nextCheckAt],
    );
    await new PgAuditStore(pool as Pool).appendWithClient(client, {
      occurredAt: now, actor, tenantId, action: "domain.verification_checked", subject: host,
      detail: { verification: result.verification },
    });
    return result;
  }, pool);
}

export async function removeCustomDomain(tenantId: string, raw: string, actor: AuditActor, pool: Database = controlPlanePool()) {
  const host = checkedHost(raw);
  await withControlPlaneTransaction(async (client) => {
    const result = await client.query("delete from domains where host = $1 and tenant_id = $2 and kind = 'custom'", [host, tenantId]);
    if (!result.rowCount) throw new Error("Domain unavailable");
    await new PgAuditStore(pool as Pool).appendWithClient(client, {
      occurredAt: new Date(), actor, tenantId, action: "domain.removed", subject: host, detail: { kind: "custom" },
    });
  }, pool);
}

/** Reissue is privileged and audited atomically; the previous token is never recovered. */
export async function reissueCustomDomain(tenantId: string, raw: string, actor: AuditActor, pool: Database = controlPlanePool()) {
  const host = checkedHost(raw);
  const token = `opentenant-${randomBytes(32).toString("hex")}`;
  const record = `_opentenant-challenge.${host}`;
  await withControlPlaneTransaction(async client => {
    const { rows } = await client.query("select host from domains where host = $1 and tenant_id = $2 and kind = 'custom' for update", [host, tenantId]);
    if (!rows.length) throw new Error("Domain unavailable");
    await client.query(
      `update domains set challenge_hash = $3, challenge_expires_at = now() + interval '24 hours',
       challenge_record = $4, verification = 'pending', active = false, verified_at = null,
       verification_valid_until = null, next_check_at = null, recheck_reason = null where host = $1 and tenant_id = $2 and kind = 'custom'`,
      [host, tenantId, hashChallenge(token), record],
    );
    await new PgAuditStore(pool as Pool).appendWithClient(client, {
      occurredAt: new Date(), actor, tenantId, action: "domain.challenge_reissued", subject: host, detail: { kind: "custom" },
    });
  }, pool);
  return { host, record, token };
}
