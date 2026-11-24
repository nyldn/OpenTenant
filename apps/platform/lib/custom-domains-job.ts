import { Resolver } from "node:dns/promises";
import { setTimeout as pause } from "node:timers/promises";
import type { Pool } from "pg";
import type { TaskList } from "graphile-worker";
import { PgAuditStore } from "@opentenant/database";
import { evaluateDomainRecheck } from "@opentenant/domains/verification";
import { controlPlanePool, withControlPlaneTransaction } from "./control-plane";
import type { TxtResolver } from "./custom-domains";

export const CUSTOM_DOMAIN_BATCH_SIZE = 25;
export const CUSTOM_DOMAIN_CRONTAB = "* * * * * custom_domain_reverify ?max=5";
const eligible = `kind = 'custom' and verified_at is not null
  and verification_valid_until is not null and challenge_hash is not null
  and challenge_expires_at is not null and challenge_record is not null
  and verification in ('verified', 'failed') and next_check_at <= $1`;

interface DomainReference { host: string; tenant_id: string }
interface DueDomain extends DomainReference {
  challenge_hash: string;
  challenge_record: string;
  challenge_expires_at: Date;
  verification_valid_until: Date;
}

/** The selector only returns references. Eligibility is rechecked under the row lock. */
export async function selectDueCustomDomains(pool: Pool, now: Date, limit = CUSTOM_DOMAIN_BATCH_SIZE): Promise<DomainReference[]> {
  const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(CUSTOM_DOMAIN_BATCH_SIZE, Math.floor(limit))) : CUSTOM_DOMAIN_BATCH_SIZE;
  return (await pool.query<DomainReference>(
    `select host, tenant_id from domains where ${eligible} order by next_check_at, host limit $2`, [now, bounded],
  )).rows;
}

async function resolveDomainTxt(record: string): Promise<string[][]> {
  return new Resolver({ timeout: 3000, tries: 1 }).resolveTxt(record);
}

// Bound even an injected/stalled resolver. Late answers have no persistence path.
async function observeTxt(resolveTxt: TxtResolver, record: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      resolveTxt(record),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("DNS timeout")), 3000); }),
    ]);
    return { records, unavailable: false };
  } catch {
    return { records: [], unavailable: true };
  } finally { clearTimeout(timer); }
}

export async function recheckCustomDomain(
  domain: DomainReference,
  options: { pool: Pool; resolveTxt: TxtResolver; now: () => Date },
) {
  return withControlPlaneTransaction(async client => {
    // One locked row per transaction avoids batch lock ordering and holds S1 reissue
    // off until DNS and audit commit. Other workers skip it without resolving DNS.
    const row = (await client.query<DueDomain>(
      `select host, tenant_id, challenge_hash, challenge_record, challenge_expires_at,
       verification_valid_until from domains where ${eligible} and host = $2 and tenant_id = $3
       for update skip locked`, [options.now(), domain.host, domain.tenant_id],
    )).rows[0];
    if (!row) return false;
    const observation = await observeTxt(options.resolveTxt, row.challenge_record);
    const now = options.now();
    const result = evaluateDomainRecheck({
      host: row.host,
      challenge: { hash: row.challenge_hash, expiresAt: row.challenge_expires_at, previouslyVerified: true },
      validUntil: row.verification_valid_until,
    }, observation.records, now, observation.unavailable ? "dns_unavailable" : "dns_unverified");
    await client.query(
      `update domains set verification = $3, active = $4, verification_valid_until = $5,
       next_check_at = $6, recheck_reason = $7,
       verified_at = case when $7::text is null then $8 else verified_at end
       where host = $1 and tenant_id = $2 and kind = 'custom'`,
      [row.host, row.tenant_id, result.verification, result.active, result.validUntil, result.nextCheckAt, result.reason, now],
    );
    await new PgAuditStore(options.pool).appendWithClient(client, {
      occurredAt: now, actor: { kind: "system", job: "custom_domain_reverify" },
      tenantId: row.tenant_id, action: "domain.reverification_checked", subject: row.host,
      detail: { verification: result.verification, active: result.active, reason: result.reason },
    });
    return true;
  }, options.pool);
}

/** No request payload can choose the database, clock or resolver. Tests inject them directly. */
export async function runCustomDomainRechecks(options: {
  pool?: Pool; resolveTxt?: TxtResolver; now?: () => Date;
  stagger?: (milliseconds: number) => Promise<unknown>; batchSize?: number;
} = {}) {
  const pool = options.pool ?? controlPlanePool();
  const now = options.now ?? (() => new Date());
  const resolveTxt = options.resolveTxt ?? resolveDomainTxt;
  const stagger = options.stagger ?? pause;
  const domains = await selectDueCustomDomains(pool, now(), options.batchSize);
  let checked = 0;
  for (const [index, domain] of domains.entries()) {
    if (index) await stagger(100);
    if (await recheckCustomDomain(domain, { pool, resolveTxt, now })) checked++;
  }
  return { selected: domains.length, checked };
}

export const customDomainWorkerTasks: TaskList = {
  custom_domain_reverify: async () => { await runCustomDomainRechecks(); },
};
