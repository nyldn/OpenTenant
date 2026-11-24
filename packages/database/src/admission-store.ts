import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  AdmissionAdapter, AdmissionDecision, AdmissionLease, AdmissionLeaseIdFactory,
  AdmissionPolicy, AdmissionReleaseRequest, AdmissionReleaseResult, AdmissionRequest, AdmissionScope,
} from "@opentenant/platform-core";

export interface PgAdmissionStoreOptions {
  clock?: { nowMs(): number | Promise<number> };
  leaseIdFactory?: AdmissionLeaseIdFactory;
  beforeCommit?: (request: AdmissionRequest) => void | Promise<void>;
}

const printable = (value: unknown): value is string => typeof value === "string" && value.length > 0
  && value.length <= 128 && value === value.trim() && /^[\x20-\x7e]+$/.test(value);
const safe = (value: unknown, positive = true): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && (positive ? value > 0 : value >= 0);
const exact = (value: object, keys: string[]) => Object.keys(value).length === keys.length
  && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const validScope = (value: unknown): value is AdmissionScope => record(value)
  && exact(value, ["tenantId", "principalId", "operation"])
  && printable(value.tenantId) && printable(value.principalId) && printable(value.operation);
const validRequest = (value: unknown): value is AdmissionRequest => record(value)
  && exact(value, ["scope", "idempotencyKey", "fingerprint", "sizeBytes"])
  && validScope(value.scope) && printable(value.idempotencyKey) && printable(value.fingerprint) && safe(value.sizeBytes, false);
const policyKeys = ["maxRequests", "windowMs", "maxConcurrent", "leaseMs", "idempotencyTtlMs", "maxIdempotencyEntriesPerScope", "maxSizeBytes"];
const validPolicy = (value: unknown): value is AdmissionPolicy => record(value) && exact(value, policyKeys)
  && safe(value.maxRequests) && safe(value.windowMs) && safe(value.maxConcurrent) && safe(value.leaseMs)
  && safe(value.idempotencyTtlMs) && safe(value.maxIdempotencyEntriesPerScope) && safe(value.maxSizeBytes, false)
  && value.idempotencyTtlMs >= value.leaseMs;
const validRelease = (value: unknown): value is AdmissionReleaseRequest => record(value)
  && exact(value, ["scope", "leaseId"]) && validScope(value.scope)
  && typeof value.leaseId === "string" && /^[0-9a-f]{32}$/.test(value.leaseId);
const freeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested);
    Object.freeze(value);
  }
  return value;
};
const denied = (code: Exclude<AdmissionDecision, { admitted: true }>["code"]): AdmissionDecision => freeze({ admitted: false, code });
const released = (status: AdmissionReleaseResult["status"]): AdmissionReleaseResult => freeze({ status });
const scopeKey = (scope: AdmissionScope) => `${scope.tenantId.length}:${scope.tenantId}${scope.principalId.length}:${scope.principalId}${scope.operation.length}:${scope.operation}`;
const snapshot = (policy: AdmissionPolicy) => ({ ...policy });

type LeaseRow = { lease_id: string; principal_id: string; operation: string; admitted_ms: string; expires_ms: string; policy_snapshot: AdmissionPolicy };

export class PgAdmissionStore implements AdmissionAdapter {
  private readonly ids: AdmissionLeaseIdFactory;
  constructor(private readonly pool: Pool, private readonly options: PgAdmissionStoreOptions = {}) {
    this.ids = options.leaseIdFactory ?? { nextLeaseId: () => randomBytes(16).toString("hex") };
  }

  async admit(rawRequest: AdmissionRequest, rawPolicy: AdmissionPolicy): Promise<AdmissionDecision> {
    let request: AdmissionRequest;
    let policy: AdmissionPolicy;
    try {
      if (!validRequest(rawRequest) || !validPolicy(rawPolicy)) return denied("invalid_request");
      request = freeze({ ...rawRequest, scope: { ...rawRequest.scope } });
      policy = freeze({ ...rawPolicy });
    } catch { return denied("invalid_request"); }
    try {
      return await this.transaction(async (client) => {
        const now = await this.now(client);
        if (now === null) return denied("invalid_request");
        const expires = now + policy.leaseMs;
        const retainedUntil = now + policy.idempotencyTtlMs;
        if (![expires, retainedUntil].every(Number.isSafeInteger)) return denied("invalid_request");
        const key = scopeKey(request.scope);
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
        await client.query(`delete from admission_idempotency_records where tenant_id=$1 and scope_key=$2 and retained_until <= to_timestamp($3/1000.0)`, [request.scope.tenantId, key, now]);
        await client.query(`update admission_leases set status='expired' where tenant_id=$1 and scope_key=$2 and status='active' and expires_at <= to_timestamp($3/1000.0)`, [request.scope.tenantId, key, now]);
        await client.query(`delete from admission_leases where tenant_id=$1 and scope_key=$2 and retained_until <= to_timestamp($3/1000.0) and not exists (select 1 from admission_idempotency_records i where i.tenant_id=admission_leases.tenant_id and i.scope_key=admission_leases.scope_key and i.lease_id=admission_leases.lease_id)`, [request.scope.tenantId, key, now]);
        await client.query(`delete from admission_windows w using admission_policies p where w.tenant_id=$1 and w.scope_key=$2 and p.tenant_id=w.tenant_id and p.scope_key=w.scope_key and w.window_started_at + p.window_ms * interval '1 millisecond' <= to_timestamp($3/1000.0)`, [request.scope.tenantId, key, now]);
        await client.query(`delete from admission_policies p where p.tenant_id=$1 and p.scope_key=$2 and not exists (select 1 from admission_windows w where w.tenant_id=p.tenant_id and w.scope_key=p.scope_key) and not exists (select 1 from admission_leases l where l.tenant_id=p.tenant_id and l.scope_key=p.scope_key)`, [request.scope.tenantId, key]);
        const persisted = (await client.query(`select * from admission_policies where tenant_id=$1 and scope_key=$2 for update`, [request.scope.tenantId,key])).rows[0];
        if (persisted && (persisted.principal_id !== request.scope.principalId || persisted.operation !== request.scope.operation
          || Number(persisted.max_requests) !== policy.maxRequests || Number(persisted.window_ms) !== policy.windowMs
          || Number(persisted.max_concurrent) !== policy.maxConcurrent || Number(persisted.lease_ms) !== policy.leaseMs
          || Number(persisted.idempotency_ttl_ms) !== policy.idempotencyTtlMs
          || Number(persisted.max_idempotency_entries) !== policy.maxIdempotencyEntriesPerScope
          || Number(persisted.max_size_bytes) !== policy.maxSizeBytes)) return denied("invalid_request");
        const replay = (await client.query<LeaseRow & { fingerprint: string }>(`select i.fingerprint,l.lease_id,l.principal_id,l.operation,(extract(epoch from l.admitted_at)*1000)::bigint as admitted_ms,(extract(epoch from l.expires_at)*1000)::bigint as expires_ms,l.policy_snapshot from admission_idempotency_records i join admission_leases l using (tenant_id,scope_key,lease_id) where i.tenant_id=$1 and i.scope_key=$2 and i.idempotency_key=$3 and i.retained_until > to_timestamp($4/1000.0)`, [request.scope.tenantId,key,request.idempotencyKey,now])).rows[0];
        if (replay) return replay.fingerprint === request.fingerprint ? this.decision(request.scope, replay, true) : denied("idempotency_conflict");
        if (request.sizeBytes > policy.maxSizeBytes) return denied("size_exceeded");
        const retained = Number((await client.query(`select count(*) from admission_idempotency_records where tenant_id=$1 and scope_key=$2`, [request.scope.tenantId,key])).rows[0]?.count ?? 0);
        if (retained >= policy.maxIdempotencyEntriesPerScope) return denied("idempotency_capacity");
        const windowStart = Math.floor(now / policy.windowMs) * policy.windowMs;
        const currentWindow = (await client.query(`select admitted_count,limit_count from admission_windows where tenant_id=$1 and scope_key=$2 and window_started_at=to_timestamp($3/1000.0) for update`, [request.scope.tenantId,key,windowStart])).rows[0];
        if (currentWindow && (Number(currentWindow.limit_count) !== policy.maxRequests || Number(currentWindow.admitted_count) >= policy.maxRequests)) return denied("rate_limited");
        const active = Number((await client.query(`select count(*) from admission_leases where tenant_id=$1 and scope_key=$2 and status='active' and expires_at > to_timestamp($3/1000.0)`, [request.scope.tenantId,key,now])).rows[0]?.count ?? 0);
        if (active >= policy.maxConcurrent) return denied("concurrency_limited");
        const leaseId = await this.ids.nextLeaseId();
        if (typeof leaseId !== "string" || !/^[0-9a-f]{32}$/.test(leaseId)) return denied("invalid_request");
        await client.query(`insert into admission_policies (tenant_id,scope_key,principal_id,operation,max_requests,window_ms,max_concurrent,lease_ms,idempotency_ttl_ms,max_idempotency_entries,max_size_bytes)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing`, [request.scope.tenantId,key,request.scope.principalId,request.scope.operation,policy.maxRequests,policy.windowMs,policy.maxConcurrent,policy.leaseMs,policy.idempotencyTtlMs,policy.maxIdempotencyEntriesPerScope,policy.maxSizeBytes]);
        const window = await client.query(`insert into admission_windows (tenant_id,scope_key,window_started_at,admitted_count,limit_count) values ($1,$2,to_timestamp($3/1000.0),1,$4)
          on conflict (tenant_id,scope_key,window_started_at) do update set admitted_count=admission_windows.admitted_count+1 where admission_windows.limit_count=$4 and admission_windows.admitted_count < admission_windows.limit_count returning admitted_count`, [request.scope.tenantId,key,windowStart,policy.maxRequests]);
        if (window.rowCount !== 1) return denied("rate_limited");
        const lease = await client.query<LeaseRow>(`insert into admission_leases (tenant_id,scope_key,lease_id,principal_id,operation,admitted_at,expires_at,retained_until,status,policy_snapshot) values ($1,$2,$3,$4,$5,to_timestamp($6/1000.0),to_timestamp($7/1000.0),to_timestamp($8/1000.0),'active',$9::jsonb) returning lease_id,principal_id,operation,(extract(epoch from admitted_at)*1000)::bigint as admitted_ms,(extract(epoch from expires_at)*1000)::bigint as expires_ms,policy_snapshot`, [request.scope.tenantId,key,leaseId,request.scope.principalId,request.scope.operation,now,expires,retainedUntil,JSON.stringify(snapshot(policy))]);
        await client.query(`insert into admission_idempotency_records (tenant_id,scope_key,idempotency_key,fingerprint,lease_id,retained_until) values ($1,$2,$3,$4,$5,to_timestamp($6/1000.0))`, [request.scope.tenantId,key,request.idempotencyKey,request.fingerprint,leaseId,retainedUntil]);
        await this.options.beforeCommit?.(request);
        return this.decision(request.scope, lease.rows[0]!, false);
      });
    } catch { return denied("invalid_request"); }
  }

  async release(raw: AdmissionReleaseRequest): Promise<AdmissionReleaseResult> {
    try { if (!validRelease(raw)) return released("invalid_request"); }
    catch { return released("invalid_request"); }
    try { return await this.transaction(async (client) => {
      const now = await this.now(client); if (now === null) return released("invalid_request");
      const key = scopeKey(raw.scope); await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
      const row = (await client.query(`select status, expires_at <= to_timestamp($4/1000.0) as expired from admission_leases where tenant_id=$1 and scope_key=$2 and lease_id=$3 for update`, [raw.scope.tenantId,key,raw.leaseId,now])).rows[0];
      if (!row) return released("not_found"); if (row.status === "released") return released("already_released");
      if (row.status === "expired" || row.expired) { await client.query(`update admission_leases set status='expired' where tenant_id=$1 and scope_key=$2 and lease_id=$3`, [raw.scope.tenantId,key,raw.leaseId]); return released("expired"); }
      await client.query(`update admission_leases set status='released' where tenant_id=$1 and scope_key=$2 and lease_id=$3`, [raw.scope.tenantId,key,raw.leaseId]); return released("released");
    }); } catch { return released("invalid_request"); }
  }

  private decision(scope: AdmissionScope, row: LeaseRow, replayed: boolean): AdmissionDecision {
    const lease: AdmissionLease = { leaseId: row.lease_id, scope: { ...scope }, admittedAtMs: Number(row.admitted_ms), expiresAtMs: Number(row.expires_ms), policy: { ...row.policy_snapshot } };
    return freeze({ admitted: true, replayed, lease });
  }
  private async now(client: PoolClient): Promise<number | null> {
    const value = this.options.clock ? await this.options.clock.nowMs() : Number((await client.query(`select (extract(epoch from clock_timestamp())*1000)::bigint as now_ms`)).rows[0]?.now_ms);
    return safe(value, false) ? value : null;
  }
  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect(); try { await client.query("begin"); const result = await operation(client); await client.query("commit"); return result; }
    catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }
}
