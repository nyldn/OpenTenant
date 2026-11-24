import type { AuditActor } from "@opentenant/security";

export type TrustTier = "candidate" | "validated" | "superseded";
export type Visibility = "private" | "internal" | "shared";

export interface BrainEntity {
  id: string;
  tenantId: string;
  kind: string;
  canonicalName: string;
  summary: string | null;
  metadata: Readonly<Record<string, unknown>>;
  createdAt: Date;
  updatedAt: Date;
}

export interface BrainEntityAlias {
  id: string;
  tenantId: string;
  entityId: string;
  alias: string;
  source: string;
  createdAt: Date;
}

export interface RawSignalRecord {
  id: string;
  tenantId: string;
  source: string;
  sourceId: string;
  observedAt: Date | null;
  ingestedAt: Date;
  visibility: Visibility;
  contentHash: string;
  provenance: Readonly<Record<string, string | number | boolean | null>>;
  redactedAt: Date | null;
}

export interface RawSignalPayloadRecord {
  rawSignalId: string;
  tenantId: string;
  contentType: string;
  payloadText: string;
  storedAt: Date;
}

export interface RawSignalChunkRecord {
  id: string;
  tenantId: string;
  rawSignalId: string;
  chunkIndex: number;
  tokenCount: number;
  content: string;
  embedding: ReadonlyArray<number> | null;
  embeddingDimensions: number;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  createdAt: Date;
}

export interface ValidatedContextRecord {
  id: string;
  tenantId: string;
  entityId: string;
  statement: string;
  rationale: string | null;
  trustTier: TrustTier;
  sourceChunkId: string | null;
  validatedBy: AuditActor | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContextEdgeRecord {
  id: string;
  tenantId: string;
  srcEntityId: string;
  dstEntityId: string;
  relation: string;
  claim: string;
  confidence: number | null;
  sourceChunkId: string | null;
  extractionModel: string;
  trustTier: "extracted";
  createdAt: Date;
}

export interface BrainDecisionRecord {
  id: string;
  tenantId: string;
  sequence: number;
  occurredAt: Date;
  actor: AuditActor;
  subject: string;
  decision: string;
  rationale: string;
  outcome: string | null;
  detail: Readonly<Record<string, string | number | boolean | null>>;
  previousHash: string;
  hash: string;
}

export interface BrainQuarantineRecord {
  id: string;
  tenantId: string;
  source: string;
  sourceId: string | null;
  reason: string;
  payloadCiphertext: string;
  aad: string;
  createdAt: Date;
}
