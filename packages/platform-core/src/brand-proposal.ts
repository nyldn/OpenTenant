import type { TenantId } from "@opentenant/auth";
import type { BrandTokenKey, BrandTokens } from "./branding";
import { validateBrandTokenValue } from "./brand-validation";

export type BrandProposalStatus = "draft" | "reviewed" | "discarded" | "superseded" | "applied";
export type BrandProposalSourceOrigin = "https" | "upload";

export interface HttpsBrandValueProvenance {
  kind: "https";
  sourceUrl: string;
  retrievedAt: Date;
}

export interface UploadBrandValueProvenance {
  kind: "upload";
  fileDigest: string;
  uploadedByUserId: string;
  uploadedAt: Date;
}

export type ProposedBrandValueProvenance =
  | HttpsBrandValueProvenance
  | UploadBrandValueProvenance;

export interface ProposedBrandValue<K extends BrandTokenKey = BrandTokenKey> {
  value: BrandTokens[K];
  provenance: ProposedBrandValueProvenance;
}

export type ProposedBrandValues = Partial<{
  [K in BrandTokenKey]: ProposedBrandValue<K>;
}>;

export interface BrandProposal {
  proposalId: string;
  tenantId: TenantId;
  sourceOrigin: BrandProposalSourceOrigin;
  status: BrandProposalStatus;
  values: ProposedBrandValues;
  parserVersion: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewedPolicyVersion: number | null;
  discardedAt: Date | null;
  supersededAt: Date | null;
  appliedAt: Date | null;
}

function assertTransitionTime(value: Date, earliest: Date): void {
  if (
    !(value instanceof Date)
    || !Number.isFinite(value.getTime())
    || value.getTime() < earliest.getTime()
  ) {
    throw new Error("Brand proposal requires a valid transition time");
  }
}

function assertHttpsProvenance(provenance: HttpsBrandValueProvenance): void {
  if (
    !(provenance.retrievedAt instanceof Date)
    || !Number.isFinite(provenance.retrievedAt.getTime())
  ) {
    throw new Error("Brand values require valid provenance");
  }
  let source: URL;
  try {
    source = new URL(provenance.sourceUrl);
  } catch {
    throw new Error("Brand values require valid provenance");
  }
  if (
    source.protocol !== "https:"
    || source.username !== ""
    || source.password !== ""
    || source.port !== ""
  ) {
    throw new Error("Brand values require valid provenance");
  }
}

function assertUploadProvenance(provenance: UploadBrandValueProvenance): void {
  if (!/^[a-f0-9]{64}$/u.test(provenance.fileDigest)) {
    throw new Error("Brand values require valid provenance");
  }
  if (!/^[A-Za-z0-9_-]{3,128}$/u.test(provenance.uploadedByUserId)) {
    throw new Error("Brand values require valid provenance");
  }
  if (
    !(provenance.uploadedAt instanceof Date)
    || !Number.isFinite(provenance.uploadedAt.getTime())
  ) {
    throw new Error("Brand values require valid provenance");
  }
}

export function assertProposedBrandValueProvenance(
  provenance: ProposedBrandValueProvenance,
): void {
  if (typeof provenance !== "object" || provenance === null) {
    throw new Error("Brand values require valid provenance");
  }
  if (provenance.kind === "https") {
    assertHttpsProvenance(provenance);
    return;
  }
  if (provenance.kind === "upload") {
    assertUploadProvenance(provenance);
    return;
  }
  throw new Error("Brand values require valid provenance");
}

export function createBrandProposal(
  input: Omit<
    BrandProposal,
    "status" | "reviewedAt" | "reviewedPolicyVersion" | "discardedAt" | "supersededAt" | "appliedAt"
  >,
): BrandProposal {
  if (!(input.createdAt instanceof Date) || !Number.isFinite(input.createdAt.getTime())) {
    throw new Error("Brand proposal requires a valid creation time");
  }
  for (const proposed of Object.values(input.values) as ProposedBrandValue[]) {
    assertProposedBrandValueProvenance(proposed.provenance);
    if (proposed.provenance.kind !== input.sourceOrigin) {
      throw new Error("Brand proposal value provenance must match its source origin");
    }
  }
  if (input.sourceOrigin === "upload" && (
    typeof input.parserVersion !== "string"
    || !/^[a-z][a-z0-9-]{2,63}$/u.test(input.parserVersion)
  )) {
    throw new Error("Upload brand proposals require a parser version");
  }
  if (input.sourceOrigin === "https" && input.parserVersion !== null) {
    throw new Error("Non-upload brand proposals require no parser version");
  }
  return {
    ...input,
    status: "draft",
    reviewedAt: null,
    reviewedPolicyVersion: null,
    discardedAt: null,
    supersededAt: null,
    appliedAt: null,
  };
}

export function reviewBrandProposal(
  proposal: BrandProposal,
  reviewedAt: Date,
  reviewedPolicyVersion: number,
): BrandProposal {
  if (proposal.status !== "draft") throw new Error("Only draft brand proposals can be reviewed");
  if (Object.keys(proposal.values).length === 0) {
    throw new Error("Only populated brand proposals can be reviewed");
  }
  if (!Number.isInteger(reviewedPolicyVersion) || reviewedPolicyVersion < 1) {
    throw new Error("Reviewed brand proposals require a valid policy version");
  }
  assertTransitionTime(reviewedAt, proposal.createdAt);
  return { ...proposal, status: "reviewed", reviewedAt, reviewedPolicyVersion };
}

export function discardBrandProposal(proposal: BrandProposal, discardedAt: Date): BrandProposal {
  if (proposal.status === "applied") throw new Error("Applied brand proposals are immutable");
  if (proposal.status === "superseded") throw new Error("Superseded brand proposals are immutable");
  if (proposal.status === "discarded") throw new Error("Brand proposal is already discarded");
  assertTransitionTime(discardedAt, proposal.reviewedAt ?? proposal.createdAt);
  return { ...proposal, status: "discarded", discardedAt };
}

function jsonValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => jsonValueEqual(value, right[index]));
  }
  if (
    typeof left !== "object"
    || left === null
    || typeof right !== "object"
    || right === null
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index]
      && jsonValueEqual(leftRecord[key], rightRecord[key])
    ));
}

export function editBrandProposal(
  proposal: BrandProposal,
  values: Partial<BrandTokens>,
): BrandProposal {
  if (proposal.status !== "draft" && proposal.status !== "reviewed") {
    throw new Error("Terminal brand proposals are immutable");
  }
  const entries = Object.entries(values) as [BrandTokenKey, BrandTokens[BrandTokenKey]][];
  if (entries.length === 0) throw new Error("Brand proposal edit requires changed values");
  const edited = { ...proposal.values };
  let changed = false;
  for (const [key, value] of entries) {
    const existing = proposal.values[key] as ProposedBrandValue | undefined;
    if (!existing) throw new Error(`Brand proposal does not contain ${key}`);
    const validation = validateBrandTokenValue(key, value);
    if (!validation.ok) throw new Error(validation.reason);
    if (!jsonValueEqual(validation.value, existing.value)) changed = true;
    (edited as Record<BrandTokenKey, ProposedBrandValue>)[key] = {
      value: validation.value,
      provenance: existing.provenance,
    };
  }
  if (!changed) throw new Error("Brand proposal edit requires changed values");
  return {
    ...proposal,
    status: "draft",
    values: edited,
    reviewedAt: null,
    reviewedPolicyVersion: null,
  };
}

export function supersedeBrandProposal(proposal: BrandProposal, supersededAt: Date): BrandProposal {
  if (proposal.status !== "draft") throw new Error("Only draft brand proposals can be superseded");
  assertTransitionTime(supersededAt, proposal.createdAt);
  return { ...proposal, status: "superseded", supersededAt };
}

export function applyBrandProposal(proposal: BrandProposal, appliedAt: Date): BrandProposal {
  if (proposal.status !== "reviewed") throw new Error("Only reviewed brand proposals can be applied");
  if (proposal.reviewedPolicyVersion === null) {
    throw new Error("Reviewed brand proposals require a pinned policy version");
  }
  assertTransitionTime(appliedAt, proposal.reviewedAt ?? proposal.createdAt);
  return { ...proposal, status: "applied", appliedAt };
}
