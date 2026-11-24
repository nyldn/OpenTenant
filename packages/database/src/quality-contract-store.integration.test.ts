import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { PgAuditStore } from "./audit-store";
import { PgQualityContractStore } from "./quality-contract-store";
import { qualityBindingJourney, qualityProofDatabase, reference, seedQualityModule } from "./quality-contract-store.proof";
import { qualityContractPersistenceCodec as codec } from "../../quality-contract/src/persistence";
import { effectiveContract } from "../../quality-contract/src/contract";
import { syntheticPassingRun, SYNTHETIC_BASELINE_METRICS } from "../../quality-contract/src/synthetic";

const url = process.env.QUALITY_CONTRACT_DATABASE_URL ?? process.env.CONTROL_PLANE_INTEGRATION_DATABASE_URL;
if (process.env.QUALITY_CONTRACT_DB_REQUIRED === "1" && !url) throw new Error("Quality contract PostgreSQL proof requires a database URL");
let pool: Pool;
let dispose: (() => Promise<void>) | undefined;
async function counts(tenantId: string) {
  const { rows } = await pool.query(`select
    (select count(*)::int from module_quality_contracts where tenant_id=$1) as contracts,
    (select count(*)::int from module_quality_evaluations where tenant_id=$1) as evaluations,
    (select count(*)::int from audit_events where tenant_id=$1 and action like 'quality.%.recorded') as audits`, [tenantId]);
  return rows[0];
}

describe.skipIf(!url)("immutable quality persistence against PostgreSQL", () => {
  beforeAll(async () => {
    const proof = await qualityProofDatabase(url!);
    pool = proof.pool;
    dispose = proof.dispose;
  }, 120000);
  afterAll(async () => { await dispose?.(); });

  it("binds, evaluates and reads through the server-side journey with an intact audit chain", async () => {
    const result = await qualityBindingJourney(pool);
    expect(await counts(result.tenantId)).toEqual({ contracts: 2, evaluations: 1, audits: 3 });
  });

  it("refuses wrong owners, version/digest pairs, weak digests and shared modules", async () => {
    const f = await seedQualityModule(pool);
    for (const changed of [{ tenantId: f.otherTenantId }, { moduleVersion: "2" }, { artifactDigest: "weak" },
      { moduleVersion: "5", artifactDigest: "e".repeat(64) }]) {
      await expect(f.store.recordContract({ ...f.input, ...changed })).rejects.toThrow();
    }
    for (const scope of ["platform", "installation"]) {
      const key = `quality-${scope}-${randomUUID()}`;
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(`insert into module_catalog (module_key,version,runtime,enabled_by_default,ownership_scope,installation_id)
          select $1,'1','native',false,$2,case when $2='installation' then installation_id end from installation_metadata where singleton`, [key, scope]);
        await client.query("insert into module_versions (module_key,version,artifact_digest,created_by_user_id) values ($1,'1',$2,$3)", [key, "a".repeat(64), f.userId]);
        await client.query("commit");
      } finally { client.release(); }
      await expect(f.store.recordContract({ ...f.input, moduleKey: key, contract: { ...f.contract, moduleId: key } })).rejects.toThrow("binding");
    }
    expect(await counts(f.tenantId)).toEqual({ contracts: 0, evaluations: 0, audits: 0 });
  });

  it("serializes concurrent replay, rejects conflicting reuse and rolls audit back on failed insert", async () => {
    const f = await seedQualityModule(pool);
    const [one, replay] = await Promise.all([f.store.recordContract(f.input), f.store.recordContract(f.input)]);
    expect(replay.contract_record_id).toBe(one.contract_record_id);
    await expect(f.store.recordContract({ ...f.input, reason: "Changed attribution" })).rejects.toThrow("conflict");
    await expect(f.store.recordContract({ ...f.input, submissionId: randomUUID() })).rejects.toThrow("conflict");
    const later = { ...f.input, moduleVersion: "2", artifactDigest: "b".repeat(64), submissionId: randomUUID() };
    await f.store.recordContract(later);
    await expect(f.store.recordContract({ ...later, moduleVersion: "3", artifactDigest: "c".repeat(64), submissionId: randomUUID(),
      contract: { ...f.contract, comparison: { ...f.contract.comparison, minimumEffect: 0.04 } } })).rejects.toThrow("logical version");
    expect(await counts(f.tenantId)).toEqual({ contracts: 2, evaluations: 0, audits: 2 });
    expect((await new PgAuditStore(pool).verifyChain(f.tenantId)).intact).toBe(true);
  });

  it("preserves accepted, rejected and no-change evaluations, with replay and envelope deduplication", async () => {
    const f = await qualityBindingJourney(pool);
    const input = { tenantId: f.tenantId, submissionId: randomUUID(), recordedByUserId: f.userId, reason: "Comparison history",
      baseline: reference(f.baseline), candidate: reference(f.candidate), baselineRun: f.run, candidateRun: f.run };
    const noChange = await f.store.recordEvaluation(input);
    expect((noChange.evidence_body as { result: { verdict: string } }).result.verdict).toBe("no_change");
    const replay = await f.store.recordEvaluation(input);
    expect(replay.evaluation_id).toBe(noChange.evaluation_id);
    await expect(f.store.recordEvaluation({ ...input, reason: "Other reason" })).rejects.toThrow("conflict");
    await expect(f.store.recordEvaluation({ ...input, submissionId: randomUUID() })).rejects.toThrow("conflict");
    const rejected = await f.store.recordEvaluation({ ...input, submissionId: randomUUID(), candidateRun: { ...f.run, contractDigest: "f".repeat(64) } });
    expect(rejected.evidence_body).toMatchObject({ candidateRun: { contractDigest: "f".repeat(64) }, result: { verdict: "rejected", failures: [{ kind: "run_contract_mismatch" }] } });
    await expect(f.store.recordEvaluation({ ...input, submissionId: randomUUID(), candidate: { ...input.candidate, artifactDigest: "c".repeat(64) } })).rejects.toThrow("binding");
    await expect(f.store.recordEvaluation({ ...input, submissionId: randomUUID(), tenantId: f.otherTenantId })).rejects.toThrow("binding");
    await expect(f.store.recordEvaluation({ ...input, submissionId: randomUUID(), candidateRun: { ...f.run, metrics: [{ metric: "x", value: NaN }] } })).rejects.toThrow();
    expect(await counts(f.tenantId)).toEqual({ contracts: 2, evaluations: 3, audits: 5 });
  });

  it("recomputes effective contracts and retains early weakening rejection", async () => {
    const f = await seedQualityModule(pool);
    const baseline = await f.store.recordContract(f.input);
    const proposed = { ...f.contract, version: 2, outcomes: [...f.contract.outcomes, { ...f.contract.outcomes[0]!, id: "outcome.extra" }] };
    const candidate = await f.store.recordContract({ ...f.input, moduleVersion: "2", artifactDigest: "b".repeat(64), submissionId: randomUUID(), contract: proposed });
    const effective = effectiveContract(f.contract, proposed);
    const run = syntheticPassingRun(f.contract, SYNTHETIC_BASELINE_METRICS);
    const input = { tenantId: f.tenantId, submissionId: randomUUID(), recordedByUserId: f.userId, reason: "Effective contract proof",
      baseline: reference(baseline), candidate: reference(candidate), baselineRun: run,
      candidateRun: syntheticPassingRun(effective, SYNTHETIC_BASELINE_METRICS) };
    const result = await f.store.recordEvaluation(input);
    const expected = codec.evaluation({ baseline: input.baseline, candidate: input.candidate, baselineContract: f.contract, candidateContract: proposed, baselineRun: input.baselineRun, candidateRun: input.candidateRun });
    expect(result.evidence_body).toEqual(expected.body);
    expect(result.evidence_digest).toBe(expected.digest);
    const weak = { ...f.contract, version: 3, comparison: { ...f.contract.comparison, minimumEffect: 0.001 } };
    const weakRecord = await f.store.recordContract({ ...f.input, moduleVersion: "3", artifactDigest: "c".repeat(64), submissionId: randomUUID(), contract: weak });
    const weakened = await f.store.recordEvaluation({ ...input, submissionId: randomUUID(), candidate: reference(weakRecord), candidateRun: run });
    expect(weakened.evidence_body).toMatchObject({ effectiveContract: null, effectiveContractDigest: null, result: { verdict: "rejected", failures: [{ kind: "weakened_contract" }] } });

  });

  it("blocks ordinary UPDATE, DELETE, TRUNCATE and tenant deletion at the database", async () => {
    const f = await qualityBindingJourney(pool);
    for (const table of ["module_quality_contracts", "module_quality_evaluations"]) {
      for (const command of [`update ${table} set reason=reason`, `delete from ${table}`, `truncate ${table} cascade`]) {
        await expect(pool.query(command)).rejects.toThrow("insert-only");
      }
    }
    await expect(pool.query("delete from tenants where tenant_id=$1", [f.tenantId])).rejects.toThrow();
    // Statements that change no evidence rows (e.g. unrelated cascades) are not blocked.
    for (const table of ["module_quality_contracts", "module_quality_evaluations"]) {
      await expect(pool.query(`delete from ${table} where false`)).resolves.toMatchObject({ rowCount: 0 });
      await expect(pool.query(`update ${table} set reason=reason where false`)).resolves.toMatchObject({ rowCount: 0 });
    }
    expect((await new PgAuditStore(pool).verifyChain(f.tenantId)).intact).toBe(true);
  });

  it("erases quality lineage only through the authorized tenant lifecycle and preserves other tenants", async () => {
    const erased = await qualityBindingJourney(pool);
    const survivor = await qualityBindingJourney(pool);
    const survivorCounts = await counts(survivor.tenantId);
    const audit = new PgAuditStore(pool);
    const originalCounts = await counts(erased.tenantId);

    await expect(pool.query("select hard_erase_tenant($1)", [erased.tenantId])).rejects.toThrow("not ready");
    await pool.query(`update tenants set status='deleted', deleted_at=now(),
      erase_after=now()+interval '1 day', database_erased_at=now() where tenant_id=$1`, [erased.tenantId]);
    await expect(pool.query("select hard_erase_tenant($1)", [erased.tenantId])).rejects.toThrow("not ready");
    await pool.query(`update tenants set erase_after=now()-interval '1 second', database_erased_at=null
      where tenant_id=$1`, [erased.tenantId]);
    await expect(pool.query("select hard_erase_tenant($1)", [erased.tenantId])).rejects.toThrow("not ready");
    expect(await counts(erased.tenantId)).toEqual(originalCounts);
    await pool.query("update tenants set database_erased_at=now() where tenant_id=$1", [erased.tenantId]);

    // The owner procedure must relax both evidence and audit guards atomically.
    // Rollback restores rows and trigger state before the committed attempt.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select hard_erase_tenant($1)", [erased.tenantId]);
      for (const table of ["module_quality_contracts", "module_quality_evaluations", "audit_events", "tenants"]) {
        expect((await client.query(`select count(*)::int n from ${table} where tenant_id=$1`, [erased.tenantId])).rows[0].n).toBe(0);
      }
    } finally {
      await client.query("rollback");
      client.release();
    }
    expect(await counts(erased.tenantId)).toEqual(originalCounts);
    expect((await audit.verifyChain(erased.tenantId)).intact).toBe(true);
    await expect(pool.query("delete from module_quality_contracts where tenant_id=$1", [erased.tenantId])).rejects.toThrow("insert-only");
    await expect(pool.query("update module_quality_evaluations set reason=reason where tenant_id=$1", [erased.tenantId])).rejects.toThrow("insert-only");

    await pool.query("select hard_erase_tenant($1)", [erased.tenantId]);
    for (const table of ["module_quality_contracts", "module_quality_evaluations", "audit_events", "tenants"]) {
      expect((await pool.query(`select count(*)::int n from ${table} where tenant_id=$1`, [erased.tenantId])).rows[0].n).toBe(0);
    }
    expect((await pool.query("select count(*)::int n from module_catalog where owner_tenant_id=$1", [erased.tenantId])).rows[0].n).toBe(0);
    expect(await counts(survivor.tenantId)).toEqual(survivorCounts);
    expect((await audit.verifyChain(survivor.tenantId)).intact).toBe(true);
    await expect(survivor.store.getEvaluation({ ...reference(survivor.candidate),
      evaluationId: survivor.evaluation.evaluation_id, readerUserId: survivor.userId })).resolves.toMatchObject({ evidence_digest: survivor.evaluation.evidence_digest });
    await expect(pool.query("delete from module_quality_evaluations where tenant_id=$1", [survivor.tenantId])).rejects.toThrow("insert-only");
    const { rows: guards } = await pool.query(`select tgenabled from pg_trigger
      where tgname in ('module_quality_contracts_immutable','module_quality_evaluations_immutable',
        'module_quality_contracts_no_truncate','module_quality_evaluations_no_truncate')`);
    expect(guards).toEqual([{ tgenabled: "O" }, { tgenabled: "O" }, { tgenabled: "O" }, { tgenabled: "O" }]);
  });

  it("rejects an unrelated audit sequence and direct cross-tenant insertion", async () => {
    const f = await qualityBindingJourney(pool);
    // Copy a valid row but attach another audit event or another tenant.
    const columns = Object.keys(f.baseline);
    const copy = async (changed: Record<string, unknown>) => {
      const row = { ...f.baseline, contract_record_id: randomUUID(), submission_id: randomUUID(), ...changed };
      return pool.query(`insert into module_quality_contracts (${columns.join(",")}) values (${columns.map((_, i) => `$${i + 1}`).join(",")})`, columns.map(key => row[key as keyof typeof row]));
    };
    await expect(copy({ audit_sequence: f.evaluation.audit_sequence })).rejects.toThrow("exact atomic audit");
    await expect(copy({ tenant_id: f.otherTenantId })).rejects.toThrow("ownership");
    expect(await counts(f.tenantId)).toEqual({ contracts: 2, evaluations: 1, audits: 3 });
  });

  it("fails closed on corrupted body, verdict, digest and failed read audit", async () => {
    const f = await qualityBindingJourney(pool);
    const corruptingPool = (table: string, mutate: (row: Record<string, unknown>) => void) => ({
      async connect() {
        const client = await pool.connect();
        return {
          async query(sql: string, values?: unknown[]) {
            const result = await client.query(sql, values);
            if (sql.startsWith(`select * from ${table}`)) {
              for (const row of result.rows) mutate(row);
            }
            return result;
          },
          release() { client.release(); },
        };
      },
    }) as unknown as Pool;
    for (const mutate of [
      (row: Record<string, unknown>) => { row.contract_digest = "0".repeat(64); },
      (row: Record<string, unknown>) => { row.contract_body = { ...f.contract, version: 99 }; },
    ]) {
      const corrupt = new PgQualityContractStore(corruptingPool("module_quality_contracts", mutate), codec);
      await expect(corrupt.getContract({ ...reference(f.baseline), readerUserId: f.userId })).rejects.toThrow("integrity");
    }
    for (const mutate of [
      (row: Record<string, unknown>) => { row.evidence_digest = "0".repeat(64); },
      (row: Record<string, unknown>) => {
        const body = row.evidence_body as { result: { verdict: string } };
        body.result.verdict = "rejected";
      },
    ]) {
      const corrupt = new PgQualityContractStore(corruptingPool("module_quality_evaluations", mutate), codec);
      await expect(corrupt.getEvaluation({ ...reference(f.candidate), evaluationId: f.evaluation.evaluation_id, readerUserId: f.userId })).rejects.toThrow("integrity");
    }
    const before = (await pool.query("select count(*)::int n from audit_events where tenant_id=$1", [f.tenantId])).rows[0].n;
    await expect(f.store.getContract({ ...reference(f.baseline), readerUserId: "invalid user" })).rejects.toThrow("invalid");
    await expect(f.store.getContract({ ...reference(f.baseline), tenantId: f.otherTenantId, readerUserId: f.userId })).rejects.toThrow("binding");
    expect((await pool.query("select count(*)::int n from audit_events where tenant_id=$1", [f.tenantId])).rows[0].n).toBe(before);
  });
});
