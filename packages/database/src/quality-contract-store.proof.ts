import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { loadControlPlaneMigrations } from "../../../tooling/migrations/src/control-plane";
import { applyMigrations } from "../../../tooling/migrations/src/runner";
import { qualityContractPersistenceCodec as codec } from "../../quality-contract/src/persistence";
import { syntheticBaselineContract, syntheticPassingRun, SYNTHETIC_BASELINE_METRICS } from "../../quality-contract/src/synthetic";
import type { QualityContract } from "../../quality-contract/src/contract";
import type { EvaluationRun } from "../../quality-contract/src/evaluate";
import type { RecordQualityContractInput, QualityEvaluationRecord } from "./quality-contract-store";
import { PgAuditStore } from "./audit-store";
import { PgModuleOwnershipStore } from "./module-ownership-store";
import { PgQualityContractStore, type QualityContractRecord } from "./quality-contract-store";

export function reference(row: QualityContractRecord) {
  return { tenantId: row.tenant_id, moduleKey: row.module_key, moduleVersion: row.module_version, artifactDigest: row.artifact_digest, contractRecordId: row.contract_record_id };
}

/** Own database, canonical catalog, pinned ephemeral host. Never reset a shared DB. */
export async function qualityProofDatabase(url: string) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    || !parsed.pathname.startsWith("/opentenant_") || parsed.port === "5432") throw new Error("Synthetic ephemeral loopback database required");
  const name = `opentenant_it_quality_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: url });
  let pool: Pool | undefined;
  try {
    await admin.query(`create database ${name}`);
    parsed.pathname = `/${name}`;
    pool = new Pool({ connectionString: parsed.href, max: 5 });
    const migrations = await loadControlPlaneMigrations();
    assert(migrations.some(m => m.id === "0090_quality_contract_persistence"));
    await applyMigrations(pool, migrations);
    return { pool, async dispose() { await pool!.end(); await admin.query(`drop database ${name}`); await admin.end(); } };
  } catch (error) {
    await pool?.end();
    await admin.query(`drop database if exists ${name}`).catch(() => undefined);
    await admin.end();
    throw error;
  }
}

export async function seedQualityModule(pool: Pool): Promise<{
  tenantId: string; otherTenantId: string; userId: string; moduleKey: string;
  contract: QualityContract; store: PgQualityContractStore;
  input: RecordQualityContractInput & { contract: QualityContract };
}> {
  const suffix = randomUUID().replaceAll("-", "");
  const tenantId = `ten_quality_${suffix}`;
  const otherTenantId = `ten_other_${suffix}`;
  const userId = `user_quality_${suffix}`;
  const moduleKey = `quality-${suffix}`;
  await pool.query(`insert into tenants (tenant_id,slug,display_name,status,data_region) values
    ($1,$1,'Example quality tenant','active','us'),($2,$2,'Example other tenant','active','us')`, [tenantId, otherTenantId]);
  await pool.query("insert into platform_users (user_id,email,display_name) values ($1,$2,'Example quality reviewer')", [userId, `${userId}@example.test`]);
  await new PgModuleOwnershipStore(pool).createTenantPrivate({ tenantId: tenantId as import("@opentenant/auth").TenantId,
    moduleKey, version: "1", runtime: "native", artifactDigest: "a".repeat(64), remoteUrl: null, createdByUserId: userId });
  for (const [version, digest, kind] of [["2", "b", "sha256_artifact"], ["3", "c", "sha256_artifact"], ["4", "d", "sha256_artifact"], ["5", "e", "legacy_identity"]]) {
    await pool.query("insert into module_versions (module_key,version,artifact_digest,digest_kind,created_by_user_id) values ($1,$2,$3,$4,$5)", [moduleKey, version, digest!.repeat(64), kind, userId]);
  }
  const contract = { ...syntheticBaselineContract(), moduleId: moduleKey };
  const store = new PgQualityContractStore(pool, codec);
  const input = { tenantId, moduleKey, moduleVersion: "1", artifactDigest: "a".repeat(64), contract,
    submissionId: randomUUID(), recordedByUserId: userId, reason: "Synthetic artifact proof" };
  return { tenantId, otherTenantId, userId, moduleKey, contract, store, input };
}

/** Server-side E18 journey, also called by the registered Playwright spec. */
export async function qualityBindingJourney(pool: Pool): Promise<Awaited<ReturnType<typeof seedQualityModule>> & {
  baseline: QualityContractRecord; candidate: QualityContractRecord;
  evaluation: QualityEvaluationRecord; run: EvaluationRun;
}> {
  const fixture = await seedQualityModule(pool);
  const { store, input, contract, otherTenantId, userId, tenantId } = fixture;
  const baseline = await store.recordContract(input);
  await assert.rejects(store.recordContract({ ...input, submissionId: randomUUID(), moduleVersion: "2" }), /binding/);
  await assert.rejects(store.recordContract({ ...input, submissionId: randomUUID(), tenantId: otherTenantId }), /binding/);
  const candidate = await store.recordContract({ ...input, submissionId: randomUUID(), moduleVersion: "2", artifactDigest: "b".repeat(64) });
  const run = syntheticPassingRun(contract, SYNTHETIC_BASELINE_METRICS);
  const evaluation = await store.recordEvaluation({ tenantId, submissionId: randomUUID(), recordedByUserId: userId, reason: "Synthetic comparison",
    baseline: reference(baseline), candidate: reference(candidate), baselineRun: run,
    candidateRun: { ...run, metrics: run.metrics.map(sample => sample.metric === "task_completion_rate" ? { ...sample, value: 0.8 } : sample) } });
  assert.equal((evaluation.evidence_body as { result: { verdict: string } }).result.verdict, "accepted");
  const stored = await store.getEvaluation({ ...reference(candidate), evaluationId: evaluation.evaluation_id, readerUserId: userId });
  assert.equal(stored.evidence_digest, evaluation.evidence_digest);
  await assert.rejects(store.getEvaluation({ ...reference(candidate), tenantId: otherTenantId, evaluationId: evaluation.evaluation_id, readerUserId: userId }), /binding/);
  assert.equal((await new PgAuditStore(pool).verifyChain(tenantId)).intact, true);
  return { ...fixture, baseline, candidate, evaluation, run };
}
