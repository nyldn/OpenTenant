import { createHash } from "node:crypto";
import type { TenantId } from "@opentenant/auth";
import { PgQualityContractStore, QualityPersistenceError, type QualityArtifactBinding } from "@opentenant/database";
import { qualityContractPersistenceCodec } from "@opentenant/quality-contract";
import { controlPlanePool } from "./control-plane";
import { currentTenant } from "./tenant";
import { currentSession } from "./session";
import { resolvePermissions } from "./module-access";

type Target = "baseline" | "candidate";
export interface TrustedQualityArtifact {
  readonly tenantId: string;
  readonly moduleKey: string;
  readonly moduleVersion: string;
  /** Actual verified artifact bytes from the host's artifact custody, never a manifest hash. */
  readonly bytes: Uint8Array;
}
/** Configure this resolver in trusted host code, never with a request callback. */
export type TrustedQualityArtifactResolver = (tenantId: string, target: Target) => Promise<TrustedQualityArtifact>;

/** E18 has no HTTP caller. Returned operations accept content/record IDs only;
 * tenant, actor, artifact identity and live permission checks stay in the host.
 */
export function qualityContractBinding(artifacts?: TrustedQualityArtifactResolver) {
  const store = new PgQualityContractStore(controlPlanePool(), qualityContractPersistenceCodec);
  const context = async (target: Target, permission: string) => {
    const tenant = await currentTenant();
    const session = tenant && await currentSession(tenant.tenantId as TenantId);
    if (!tenant || !session || !artifacts || session.isPlatformAdmin || session.activeTenantId !== tenant.tenantId
      || !(session.expiresAt instanceof Date) || !Number.isFinite(session.expiresAt.getTime()) || session.expiresAt.getTime() <= Date.now()) throw new QualityPersistenceError("binding");
    const artifact = await artifacts(tenant.tenantId, target);
    if (artifact.tenantId !== tenant.tenantId || !(artifact.bytes instanceof Uint8Array) || artifact.bytes.byteLength === 0) throw new QualityPersistenceError("binding");
    const permissions = await resolvePermissions(session, tenant.tenantId, artifact.moduleKey);
    if (!permissions.includes(permission)) throw new QualityPersistenceError("binding");
    const binding: QualityArtifactBinding = { tenantId: tenant.tenantId, moduleKey: artifact.moduleKey,
      moduleVersion: artifact.moduleVersion, artifactDigest: createHash("sha256").update(artifact.bytes).digest("hex") };
    return { binding, userId: session.userId };
  };
  const safe = async <T>(work: () => Promise<T>): Promise<T> => {
    try { return await work(); }
    catch (error) { throw new QualityPersistenceError(error instanceof QualityPersistenceError ? error.code : "integrity"); }
  };
  return {
    recordContract: (target: Target, input: { submissionId: string; reason: string; contract: unknown }) => safe(async () => {
      const { binding, userId } = await context(target, "module.dev.contract.write");
      return store.recordContract({ submissionId: input.submissionId, reason: input.reason, contract: input.contract, ...binding, recordedByUserId: userId });
    }),
    getContract: (target: Target, contractRecordId: string) => safe(async () => {
      const { binding, userId } = await context(target, "module.dev.contract.read");
      return store.getContract({ ...binding, contractRecordId, readerUserId: userId });
    }),
    recordEvaluation: (input: { submissionId: string; reason: string; baselineContractRecordId: string; candidateContractRecordId: string; baselineRun: unknown; candidateRun: unknown }) => safe(async () => {
      const baseline = await context("baseline", "module.dev.evidence.write");
      const candidate = await context("candidate", "module.dev.evidence.write");
      if (baseline.binding.tenantId !== candidate.binding.tenantId || baseline.userId !== candidate.userId
        || baseline.binding.moduleKey !== candidate.binding.moduleKey) throw new QualityPersistenceError("binding");
      return store.recordEvaluation({ tenantId: candidate.binding.tenantId, recordedByUserId: candidate.userId,
        submissionId: input.submissionId, reason: input.reason, baselineRun: input.baselineRun, candidateRun: input.candidateRun,
        baseline: { ...baseline.binding, contractRecordId: input.baselineContractRecordId },
        candidate: { ...candidate.binding, contractRecordId: input.candidateContractRecordId } });
    }),
    getEvaluation: (evaluationId: string) => safe(async () => {
      const { binding, userId } = await context("candidate", "module.dev.evidence.read");
      return store.getEvaluation({ ...binding, evaluationId, readerUserId: userId });
    }),
  };
}
