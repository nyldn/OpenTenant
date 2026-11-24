import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { canonicalJsonStringify } from "@opentenant/security";
import { PgAuditStore } from "./audit-store";

export interface QualityArtifactBinding {
  readonly tenantId: string;
  readonly moduleKey: string;
  readonly moduleVersion: string;
  readonly artifactDigest: string;
}
interface ContractValue {
  readonly body: unknown;
  readonly contractId: string;
  readonly moduleId: string;
  readonly version: number;
  readonly digest: string;
}
interface EvaluationValue {
  readonly body: unknown;
  readonly digest: string;
  readonly verdict: string;
  readonly evaluatorVersion: string;
}
/** Inject the trusted quality-contract codec at host composition, never from HTTP. */
export interface QualityPersistenceCodec {
  contract(input: unknown): ContractValue;
  run(input: unknown): unknown;
  evaluation(input: {
    baselineContract: unknown; candidateContract: unknown;
    baselineRun: unknown; candidateRun: unknown;
    baseline: QualityArtifactBinding; candidate: QualityArtifactBinding;
  }): EvaluationValue;
}
interface Attribution {
  readonly tenantId: string;
  readonly submissionId: string;
  readonly recordedByUserId: string;
  readonly reason: string;
}
export interface RecordQualityContractInput extends QualityArtifactBinding, Attribution {
  readonly contract: unknown;
}
export interface QualityContractReference extends QualityArtifactBinding {
  readonly contractRecordId: string;
}
export interface RecordQualityEvaluationInput extends Attribution {
  readonly baseline: QualityContractReference;
  readonly candidate: QualityContractReference;
  readonly baselineRun: unknown;
  readonly candidateRun: unknown;
}
interface StoredAttribution {
  tenant_id: string; module_key: string; module_version: string; artifact_digest: string;
  submission_id: string; recorded_by_user_id: string; reason: string;
  recorded_at: Date; audit_sequence: string; request_digest: string;
}
export interface QualityContractRecord extends StoredAttribution {
  contract_record_id: string; contract_id: string; contract_version: number;
  contract_body: unknown; contract_digest: string;
}
export interface QualityEvaluationRecord extends StoredAttribution {
  evaluation_id: string; contract_record_id: string; baseline_contract_record_id: string;
  baseline_module_version: string; baseline_artifact_digest: string;
  evaluator_version: string; evidence_body: unknown; evidence_digest: string;
}
export class QualityPersistenceError extends Error {
  constructor(readonly code: "invalid" | "binding" | "conflict" | "integrity") {
    super(`Quality persistence ${code}`);
    this.name = "QualityPersistenceError";
  }
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;
function hash(value: unknown): string {
  const json = canonicalJsonStringify(value);
  if (json === undefined) throw new QualityPersistenceError("invalid");
  return createHash("sha256").update(json).digest("hex");
}
function binding(row: StoredAttribution): QualityArtifactBinding {
  return { tenantId: row.tenant_id, moduleKey: row.module_key, moduleVersion: row.module_version, artifactDigest: row.artifact_digest };
}
function validateBinding(input: QualityArtifactBinding): void {
  if (!ID.test(input.tenantId) || !ID.test(input.moduleKey)
    || !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(input.moduleVersion)
    || !SHA256.test(input.artifactDigest)) throw new QualityPersistenceError("invalid");
}
function attribution(input: Attribution): Attribution {
  const reason = input.reason.trim();
  if (!ID.test(input.tenantId) || !UUID.test(input.submissionId) || !ID.test(input.recordedByUserId)
    || reason.length < 1 || reason.length > 512) throw new QualityPersistenceError("invalid");
  return { tenantId: input.tenantId, submissionId: input.submissionId, recordedByUserId: input.recordedByUserId, reason };
}
function contractRequest(input: Attribution, target: QualityArtifactBinding, value: ContractValue): string {
  return hash({ ...input, ...target, contract: value.body });
}
function evaluationRequest(input: Attribution, baseline: QualityContractReference, candidate: QualityContractReference, baselineRun: unknown, candidateRun: unknown): string {
  return hash({ ...input, baseline, candidate, baselineRun, candidateRun });
}

/** Explicit tenant binding follows the neighbouring control-plane ownership store.
 * Permissions and trusted tenant/actor selection remain the host's responsibility.
 */
export class PgQualityContractStore {
  private readonly audit: PgAuditStore;
  constructor(private readonly pool: Pool, private readonly codec: QualityPersistenceCodec) {
    this.audit = new PgAuditStore(pool);
  }

  async recordContract(input: RecordQualityContractInput): Promise<QualityContractRecord> {
    const actor = attribution(input);
    validateBinding(input);
    const target: QualityArtifactBinding = { tenantId: actor.tenantId, moduleKey: input.moduleKey, moduleVersion: input.moduleVersion, artifactDigest: input.artifactDigest };
    const value = this.codec.contract(input.contract);
    if (value.moduleId !== target.moduleKey) throw new QualityPersistenceError("binding");
    const requestDigest = contractRequest(actor, target, value);
    return this.transaction(actor.tenantId, async client => {
      await this.owner(client, target);
      const replay = await client.query<QualityContractRecord>("select * from module_quality_contracts where tenant_id=$1 and submission_id=$2", [actor.tenantId, actor.submissionId]);
      if (replay.rows[0]) {
        const row = this.verifyContract(replay.rows[0]);
        if (row.request_digest !== requestDigest) throw new QualityPersistenceError("conflict");
        await this.verifyAudit(client, row, "quality.contract.recorded", row.contract_record_id, row.contract_digest);
        return row;
      }
      const id = randomUUID();
      const at = new Date();
      const detail = this.detail(id, target, value.digest, requestDigest, actor.reason);
      const audit = await this.audit.appendWithClient(client, {
        occurredAt: at, actor: { kind: "user", userId: actor.recordedByUserId }, tenantId: actor.tenantId,
        action: "quality.contract.recorded", subject: target.moduleKey, detail,
      });
      const { rows } = await client.query<QualityContractRecord>(
        `insert into module_quality_contracts
          (contract_record_id,submission_id,tenant_id,module_key,module_version,artifact_digest,
           contract_id,contract_version,contract_body,contract_digest,request_digest,
           recorded_by_user_id,recorded_at,reason,audit_sequence)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15) returning *`,
        [id, actor.submissionId, actor.tenantId, target.moduleKey, target.moduleVersion, target.artifactDigest,
          value.contractId, value.version, JSON.stringify(value.body), value.digest, requestDigest,
          actor.recordedByUserId, at, actor.reason, audit.sequence]);
      return this.verifyContract(rows[0]!);
    });
  }

  async recordEvaluation(input: RecordQualityEvaluationInput): Promise<QualityEvaluationRecord> {
    const actor = attribution(input);
    for (const ref of [input.baseline, input.candidate]) {
      validateBinding(ref);
      if (!UUID.test(ref.contractRecordId) || ref.tenantId !== actor.tenantId) throw new QualityPersistenceError("binding");
    }
    const baselineRun = this.codec.run(input.baselineRun);
    const candidateRun = this.codec.run(input.candidateRun);
    const requestDigest = evaluationRequest(actor, input.baseline, input.candidate, baselineRun, candidateRun);
    return this.transaction(actor.tenantId, async client => {
      const baseline = await this.contractByReference(client, input.baseline);
      const candidate = await this.contractByReference(client, input.candidate);
      const value = this.codec.evaluation({ baselineContract: baseline.contract_body, candidateContract: candidate.contract_body,
        baselineRun, candidateRun, baseline: binding(baseline), candidate: binding(candidate) });
      const replay = await client.query<QualityEvaluationRecord>("select * from module_quality_evaluations where tenant_id=$1 and submission_id=$2", [actor.tenantId, actor.submissionId]);
      if (replay.rows[0]) {
        const row = await this.verifyEvaluation(client, replay.rows[0]);
        if (row.request_digest !== requestDigest) throw new QualityPersistenceError("conflict");
        return row;
      }
      const id = randomUUID();
      const at = new Date();
      const detail = { ...this.detail(id, binding(candidate), value.digest, requestDigest, actor.reason),
        baselineContractRecordId: baseline.contract_record_id, contractRecordId: candidate.contract_record_id,
        baselineModuleVersion: baseline.module_version, baselineArtifactDigest: baseline.artifact_digest,
        evaluatorVersion: value.evaluatorVersion, verdict: value.verdict };
      const audit = await this.audit.appendWithClient(client, {
        occurredAt: at, actor: { kind: "user", userId: actor.recordedByUserId }, tenantId: actor.tenantId,
        action: "quality.evaluation.recorded", subject: candidate.module_key, detail,
      });
      const { rows } = await client.query<QualityEvaluationRecord>(
        `insert into module_quality_evaluations
          (evaluation_id,submission_id,tenant_id,module_key,module_version,artifact_digest,contract_record_id,
           baseline_module_version,baseline_artifact_digest,baseline_contract_record_id,evaluator_version,
           evidence_body,evidence_digest,request_digest,recorded_by_user_id,recorded_at,reason,audit_sequence)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18) returning *`,
        [id, actor.submissionId, actor.tenantId, candidate.module_key, candidate.module_version, candidate.artifact_digest,
          candidate.contract_record_id, baseline.module_version, baseline.artifact_digest, baseline.contract_record_id,
          value.evaluatorVersion, JSON.stringify(value.body), value.digest, requestDigest, actor.recordedByUserId, at, actor.reason, audit.sequence]);
      return this.verifyEvaluation(client, rows[0]!);
    });
  }

  async getContract(input: QualityContractReference & { readonly readerUserId: string }): Promise<QualityContractRecord> {
    return this.transaction(input.tenantId, async client => {
      const row = await this.contractByReference(client, input);
      await this.readAudit(client, input.readerUserId, row, "quality.contract.read", row.contract_record_id);
      return row;
    });
  }

  async getEvaluation(input: QualityArtifactBinding & { readonly evaluationId: string; readonly readerUserId: string }): Promise<QualityEvaluationRecord> {
    validateBinding(input);
    if (!UUID.test(input.evaluationId)) throw new QualityPersistenceError("invalid");
    return this.transaction(input.tenantId, async client => {
      await this.owner(client, input);
      const { rows } = await client.query<QualityEvaluationRecord>(
        `select * from module_quality_evaluations where tenant_id=$1 and module_key=$2
         and module_version=$3 and artifact_digest=$4 and evaluation_id=$5`,
        [input.tenantId, input.moduleKey, input.moduleVersion, input.artifactDigest, input.evaluationId]);
      if (!rows[0]) throw new QualityPersistenceError("binding");
      const row = await this.verifyEvaluation(client, rows[0]);
      await this.readAudit(client, input.readerUserId, row, "quality.evaluation.read", row.evaluation_id);
      return row;
    });
  }

  private async contractByReference(client: PoolClient, input: QualityContractReference): Promise<QualityContractRecord> {
    validateBinding(input);
    if (!UUID.test(input.contractRecordId)) throw new QualityPersistenceError("invalid");
    await this.owner(client, input);
    const { rows } = await client.query<QualityContractRecord>(
      `select * from module_quality_contracts where tenant_id=$1 and module_key=$2
       and module_version=$3 and artifact_digest=$4 and contract_record_id=$5 for share`,
      [input.tenantId, input.moduleKey, input.moduleVersion, input.artifactDigest, input.contractRecordId]);
    if (!rows[0]) throw new QualityPersistenceError("binding");
    const row = this.verifyContract(rows[0]);
    await this.verifyAudit(client, row, "quality.contract.recorded", row.contract_record_id, row.contract_digest);
    return row;
  }

  private verifyContract(row: QualityContractRecord): QualityContractRecord {
    try {
      const value = this.codec.contract(row.contract_body);
      const actor = this.storedActor(row);
      if (value.digest !== row.contract_digest || value.contractId !== row.contract_id || value.moduleId !== row.module_key
        || value.version !== row.contract_version || hash(value.body) !== hash(row.contract_body)
        || contractRequest(actor, binding(row), value) !== row.request_digest) throw new Error("integrity");
      return row;
    } catch { throw new QualityPersistenceError("integrity"); }
  }

  private async verifyEvaluation(client: PoolClient, row: QualityEvaluationRecord): Promise<QualityEvaluationRecord> {
    const baselineRef = { ...binding(row), moduleVersion: row.baseline_module_version, artifactDigest: row.baseline_artifact_digest, contractRecordId: row.baseline_contract_record_id };
    const candidateRef = { ...binding(row), contractRecordId: row.contract_record_id };
    const baseline = await this.contractByReference(client, baselineRef);
    const candidate = await this.contractByReference(client, candidateRef);
    try {
      const body = row.evidence_body as { baselineRun: unknown; candidateRun: unknown };
      const value = this.codec.evaluation({ baselineContract: baseline.contract_body, candidateContract: candidate.contract_body,
        baselineRun: body.baselineRun, candidateRun: body.candidateRun, baseline: binding(baseline), candidate: binding(candidate) });
      if (value.digest !== row.evidence_digest || value.evaluatorVersion !== row.evaluator_version
        || hash(value.body) !== hash(row.evidence_body)
        || evaluationRequest(this.storedActor(row), baselineRef, candidateRef, body.baselineRun, body.candidateRun) !== row.request_digest) throw new Error("integrity");
      await this.verifyAudit(client, row, "quality.evaluation.recorded", row.evaluation_id, row.evidence_digest, {
        baselineContractRecordId: row.baseline_contract_record_id, contractRecordId: row.contract_record_id,
        baselineModuleVersion: row.baseline_module_version, baselineArtifactDigest: row.baseline_artifact_digest,
        evaluatorVersion: value.evaluatorVersion, verdict: value.verdict,
      });
      return row;
    } catch { throw new QualityPersistenceError("integrity"); }
  }

  private async verifyAudit(client: PoolClient, row: StoredAttribution, action: string, id: string, digest: string, extra: Record<string, unknown> = {}): Promise<void> {
    const detail = { ...this.detail(id, binding(row), digest, row.request_digest, row.reason), ...extra };
    const { rowCount } = await client.query(
      `select 1 from audit_events where tenant_id=$1 and sequence=$2 and action=$3 and subject=$4
       and occurred_at=$5 and actor=$6::jsonb and detail=$7::jsonb`,
      [row.tenant_id, row.audit_sequence, action, row.module_key, row.recorded_at,
        JSON.stringify({ kind: "user", userId: row.recorded_by_user_id }), JSON.stringify(detail)]);
    if (rowCount !== 1) throw new QualityPersistenceError("integrity");
  }

  private storedActor(row: StoredAttribution): Attribution {
    return { tenantId: row.tenant_id, submissionId: row.submission_id, recordedByUserId: row.recorded_by_user_id, reason: row.reason };
  }
  private detail(recordId: string, target: QualityArtifactBinding, digest: string, requestDigest: string, reason: string) {
    return { recordId, moduleKey: target.moduleKey, moduleVersion: target.moduleVersion, artifactDigest: target.artifactDigest, digest, requestDigest, reason };
  }
  private async readAudit(client: PoolClient, userId: string, row: StoredAttribution, action: string, recordId: string): Promise<void> {
    if (!ID.test(userId)) throw new QualityPersistenceError("invalid");
    await this.audit.appendWithClient(client, { occurredAt: new Date(), actor: { kind: "user", userId },
      tenantId: row.tenant_id, action, subject: row.module_key,
      detail: { recordId, moduleVersion: row.module_version, artifactDigest: row.artifact_digest } });
  }
  private async owner(client: PoolClient, input: QualityArtifactBinding): Promise<void> {
    const { rowCount } = await client.query(
      `select 1 from module_catalog c join module_versions v on v.module_key=c.module_key
       join installation_metadata i on i.singleton and i.installation_id=c.installation_id
       where c.module_key=$2 and c.ownership_scope='tenant' and c.owner_tenant_id=$1
         and v.version=$3 and v.artifact_digest=$4 and v.digest_kind='sha256_artifact' for share of c,v,i`,
      [input.tenantId, input.moduleKey, input.moduleVersion, input.artifactDigest]);
    if (rowCount !== 1) throw new QualityPersistenceError("binding");
  }
  private async transaction<T>(tenantId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!ID.test(tenantId)) throw new QualityPersistenceError("invalid");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [tenantId]);
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      if ((error as { code?: string }).code === "23505") throw new QualityPersistenceError("conflict");
      throw error;
    } finally { client.release(); }
  }
}
