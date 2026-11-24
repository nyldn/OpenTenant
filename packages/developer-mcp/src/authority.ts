import { DEVELOPER_PROFILES, type DeveloperProfileVersion } from "./profiles";
import {
  type AssignablePermissionSlug,
  type UnassignablePermissionSlug,
  isAssignablePermissionSlug,
  isUnassignablePermissionSlug,
} from "./slugs";

export type AuthorityResolutionInput = Readonly<{
  assignedProfile: string | null;
  tokenScopes: readonly string[];
  consentedClientScopes: readonly string[];
}>;

export type AuthorityDecision = Readonly<{
  effectiveSlugs: readonly AssignablePermissionSlug[];
  profileStatus: "assigned" | "unassigned" | "unknown";
  profileVersion: DeveloperProfileVersion | null;
  rejectedUnassignableSlugs: readonly UnassignablePermissionSlug[];
  rejectedUnknownScopes: readonly RejectedUnknownScopeEvidence[];
  omittedRejectedScopeCount: number;
  truncatedScopeCount: number;
}>;

export type RejectedUnknownScopeEvidence =
  | Readonly<{ kind: "invalid_characters" }>
  | Readonly<{ kind: "oversize" }>
  | Readonly<{ kind: "literal"; value: string }>;

export const MAX_SCOPE_VALUES_PER_SOURCE = 128 as const;
export const MAX_REJECTED_UNKNOWN_SCOPES = 32 as const;
export const MAX_SCOPE_VALUE_LENGTH = 128 as const;

type RejectionEvidence = Pick<
  AuthorityDecision,
  | "rejectedUnassignableSlugs"
  | "rejectedUnknownScopes"
  | "omittedRejectedScopeCount"
  | "truncatedScopeCount"
>;

function unknownScopeEvidence(value: string): RejectedUnknownScopeEvidence {
  if (value.length > MAX_SCOPE_VALUE_LENGTH) return Object.freeze({ kind: "oversize" });
  if (!/^[\x20-\x7e]+$/.test(value)) return Object.freeze({ kind: "invalid_characters" });
  return Object.freeze({ kind: "literal", value });
}

function evidenceKey(value: RejectedUnknownScopeEvidence): string {
  return value.kind === "literal" ? `${value.kind}:${value.value}` : value.kind;
}

function rejectionEvidence(input: AuthorityResolutionInput): RejectionEvidence {
  const sources = [input.tokenScopes, input.consentedClientScopes];
  const observed = sources.flatMap((source) => source.slice(0, MAX_SCOPE_VALUES_PER_SOURCE));
  const truncatedScopeCount = sources.reduce(
    (count, source) => count + Math.max(0, source.length - MAX_SCOPE_VALUES_PER_SOURCE),
    0,
  );
  let omittedRejectedScopeCount = 0;
  const unassignable = new Set<UnassignablePermissionSlug>();
  const unknown = new Map<string, RejectedUnknownScopeEvidence>();

  for (const value of observed) {
    if (isUnassignablePermissionSlug(value)) {
      unassignable.add(value);
      continue;
    }
    if (isAssignablePermissionSlug(value)) continue;

    const evidence = unknownScopeEvidence(value);
    const key = evidenceKey(evidence);
    if (unknown.has(key)) continue;
    if (unknown.size >= MAX_REJECTED_UNKNOWN_SCOPES) {
      omittedRejectedScopeCount += 1;
      continue;
    }
    unknown.set(key, evidence);
  }

  return {
    rejectedUnassignableSlugs: Object.freeze([...unassignable].sort()),
    rejectedUnknownScopes: Object.freeze(
      [...unknown.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value),
    ),
    omittedRejectedScopeCount,
    truncatedScopeCount,
  };
}

function decision(
  effectiveSlugs: readonly AssignablePermissionSlug[],
  profileStatus: AuthorityDecision["profileStatus"],
  profileVersion: DeveloperProfileVersion | null,
  rejected: RejectionEvidence,
): AuthorityDecision {
  return Object.freeze({
    effectiveSlugs: Object.freeze([...effectiveSlugs]),
    profileStatus,
    profileVersion,
    ...rejected,
  });
}

export function resolveEffectiveAuthority(input: AuthorityResolutionInput): AuthorityDecision {
  const rejected = rejectionEvidence(input);
  if (input.assignedProfile === null) {
    return decision([], "unassigned", null, rejected);
  }
  if (!Object.hasOwn(DEVELOPER_PROFILES, input.assignedProfile)) {
    return decision([], "unknown", null, rejected);
  }

  const profile = DEVELOPER_PROFILES[input.assignedProfile as DeveloperProfileVersion];
  const tokenScopes = new Set(
    input.tokenScopes.slice(0, MAX_SCOPE_VALUES_PER_SOURCE).filter(isAssignablePermissionSlug),
  );
  const clientScopes = new Set(
    input.consentedClientScopes.slice(0, MAX_SCOPE_VALUES_PER_SOURCE).filter(isAssignablePermissionSlug),
  );
  const effectiveSlugs = profile.filter(
    (slug) => tokenScopes.has(slug) && clientScopes.has(slug),
  );
  return decision(effectiveSlugs, "assigned", input.assignedProfile as DeveloperProfileVersion, rejected);
}
