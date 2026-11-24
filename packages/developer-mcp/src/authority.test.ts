import { describe, expect, it } from "vitest";

import {
  ASSIGNABLE_PERMISSION_SLUGS,
  DEVELOPER_PROFILES,
  DEVELOPER_PERMISSION_RISKS,
  DEVELOPER_PERMISSION_SLUGS,
  UNASSIGNABLE_PERMISSION_SLUGS,
  resolveEffectiveAuthority,
} from "./index";

describe("Developer MCP authority", () => {
  it("snapshots the frozen slugs and immutable profiles", () => {
    expect(DEVELOPER_PERMISSION_SLUGS).toEqual([
      "module.dev.workspace.read",
      "module.dev.workspace.create",
      "module.dev.workspace.lifecycle",
      "module.dev.contract.read",
      "module.dev.build.execute",
      "module.dev.preview.open",
      "module.dev.evidence.read",
      "module.dev.publish.propose",
      "module.dev.publish",
      "module.dev.infrastructure.approve",
    ]);
    expect(DEVELOPER_PROFILES).toEqual({
      "developer.readonly@1": [
        "module.dev.workspace.read",
        "module.dev.contract.read",
        "module.dev.evidence.read",
      ],
      "developer.builder@1": [
        "module.dev.workspace.read",
        "module.dev.contract.read",
        "module.dev.evidence.read",
        "module.dev.workspace.create",
        "module.dev.workspace.lifecycle",
        "module.dev.build.execute",
        "module.dev.preview.open",
      ],
    });
  });

  it("partitions all slugs and keeps unassignable slugs out of profiles", () => {
    const partition = new Set([
      ...ASSIGNABLE_PERMISSION_SLUGS,
      ...UNASSIGNABLE_PERMISSION_SLUGS,
    ]);
    expect(partition).toEqual(new Set(DEVELOPER_PERMISSION_SLUGS));
    expect(partition.size).toBe(DEVELOPER_PERMISSION_SLUGS.length);
    for (const slugs of Object.values(DEVELOPER_PROFILES)) {
      expect(new Set(slugs).size).toBe(slugs.length);
      expect(slugs.every((slug) => ASSIGNABLE_PERMISSION_SLUGS.includes(slug))).toBe(true);
    }
    const profiles = Object.entries(DEVELOPER_PROFILES);
    for (const [index, [name, slugs]] of profiles.entries()) {
      for (const [otherName, otherSlugs] of profiles.slice(index + 1)) {
        expect(new Set(slugs), `${name} duplicates ${otherName}`).not.toEqual(new Set(otherSlugs));
      }
    }
    expect(Object.isFrozen(DEVELOPER_PROFILES)).toBe(true);
    expect(Object.values(DEVELOPER_PROFILES).every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(DEVELOPER_PERMISSION_RISKS)).toBe(true);
  });

  it("grants nothing without an explicit assignment, including eligible identities", () => {
    const input = {
      assignedProfile: null,
      tokenScopes: [...ASSIGNABLE_PERMISSION_SLUGS],
      consentedClientScopes: [...ASSIGNABLE_PERMISSION_SLUGS],
      developerEligible: true,
    } as const;
    expect(resolveEffectiveAuthority(input)).toMatchObject({
      effectiveSlugs: [],
      profileStatus: "unassigned",
      profileVersion: null,
    });
  });

  it.each(["developer.proposer@1", "__proto__", "constructor"])(
    "fails closed and records an unknown profile for %s",
    (assignedProfile) => {
      expect(resolveEffectiveAuthority({
        assignedProfile,
        tokenScopes: [...ASSIGNABLE_PERMISSION_SLUGS],
        consentedClientScopes: [...ASSIGNABLE_PERMISSION_SLUGS],
      })).toMatchObject({
        effectiveSlugs: [],
        profileStatus: "unknown",
        profileVersion: null,
      });
    },
  );

  it("computes a deterministic three-way intersection", () => {
    const input = {
      assignedProfile: "developer.builder@1" as const,
      tokenScopes: ["module.dev.preview.open", "module.dev.workspace.read"],
      consentedClientScopes: ["module.dev.workspace.read", "module.dev.build.execute"],
    };
    expect(resolveEffectiveAuthority(input).effectiveSlugs).toEqual([
      "module.dev.workspace.read",
    ]);
    expect(resolveEffectiveAuthority(input).profileVersion).toBe("developer.builder@1");
    expect(resolveEffectiveAuthority({
      ...input,
      tokenScopes: [...input.tokenScopes].reverse(),
      consentedClientScopes: [...input.consentedClientScopes].reverse(),
    }).effectiveSlugs).toEqual(["module.dev.workspace.read"]);
  });

  it.each(UNASSIGNABLE_PERMISSION_SLUGS)("fails closed for unassignable %s", (slug) => {
    const decision = resolveEffectiveAuthority({
      assignedProfile: "developer.builder@1",
      tokenScopes: [...ASSIGNABLE_PERMISSION_SLUGS, slug, "module.dev.unknown"],
      consentedClientScopes: [...ASSIGNABLE_PERMISSION_SLUGS, slug, "module.dev.unknown"],
    });
    expect(decision.effectiveSlugs).not.toContain(slug);
    expect(decision.rejectedUnassignableSlugs).toContain(slug);
    expect(decision.rejectedUnknownScopes).toContainEqual({
      kind: "literal",
      value: "module.dev.unknown",
    });
  });

  it("bounds hostile rejection evidence while failing closed", () => {
    const hostile = Array.from({ length: 200 }, (_, index) => `module.dev.unknown.${index}`);
    const decision = resolveEffectiveAuthority({
      assignedProfile: "developer.builder@1",
      tokenScopes: hostile,
      consentedClientScopes: [...ASSIGNABLE_PERMISSION_SLUGS],
    });
    expect(decision.effectiveSlugs).toEqual([]);
    expect(decision.rejectedUnknownScopes.length).toBeLessThanOrEqual(32);
    expect(decision.truncatedScopeCount).toBe(72);
    expect(decision.omittedRejectedScopeCount).toBeGreaterThan(0);
  });

  it("structures hostile unknown-scope evidence without retaining control characters", () => {
    const decision = resolveEffectiveAuthority({
      assignedProfile: "developer.builder@1",
      tokenScopes: ["module.dev.unknown\nforged", "x".repeat(129), "<oversize>"],
      consentedClientScopes: [],
    });
    expect(decision.rejectedUnknownScopes).toEqual([
      { kind: "invalid_characters" },
      { kind: "literal", value: "<oversize>" },
      { kind: "oversize" },
    ]);
  });
});
