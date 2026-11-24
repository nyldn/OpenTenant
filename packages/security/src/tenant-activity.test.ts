import { describe, expect, it } from "vitest";
import type { AuditEvent } from "./index";
import {
  TENANT_ACTIVITY_ACTION_POLICY,
  projectTenantActivity as projectActivity,
} from "./tenant-activity";

const projectTenantActivity = (events: readonly AuditEvent[], tenantId: string, limit?: number) =>
  projectActivity(events, tenantId, limit, ["sample.item"]);

const TENANT_ID = "tenant-example";

function event(
  sequence: number,
  action: string,
  overrides: Partial<AuditEvent> = {},
): AuditEvent {
  return {
    sequence,
    occurredAt: new Date(`2026-08-06T12:${String(sequence % 60).padStart(2, "0")}:00.000Z`),
    actor: { kind: "user", userId: `user-${sequence}` },
    tenantId: TENANT_ID,
    action,
    subject: `subject-${sequence}`,
    detail: {},
    previousHash: `previous-${sequence}`,
    hash: `hash-${sequence}`,
    ...overrides,
  };
}

describe("tenant activity policy", () => {
  it("literally snapshots every visible action and its allowed detail keys", () => {
    expect(
      Object.fromEntries(
        Object.entries(TENANT_ACTIVITY_ACTION_POLICY).map(([action, policy]) => [
          action,
          policy.metadataKeys,
        ]),
      ),
    ).toEqual({
      "brand.overrides_changed": ["changedKeys"],
      "brand.proposal.applied": ["policyVersion"],
      "brand.proposal.discarded": [],
      "brand.proposal.edited": [],
      "brand.proposal.reviewed": [],
      "brand.voice_profile.published": ["version"],
      "brand.voice_profile.revoked": ["version"],
      "domain_metadata.changed": ["changedKeys"],
      "member.invited": ["role"],
      "member.removed": ["role", "status"],
      "module.access_mode_changed": ["mode", "passcodeRotated"],
      "module.assigned": ["version", "enabled"],
      "module_metadata.changed": ["changedKeys"],
      "navigation.override_changed": ["itemId", "changedFields"],
      "support.policy_changed": ["enabled"],
      "support.session_ended": [],
      "support.session_started": [],
      "tenant.created": ["dataRegion"],
      "tenant.provisioned": [],
    });
  });

  it("projects existing settings, membership, domain, module, brand and support actions", () => {
    const records = projectTenantActivity([
      event(1, "navigation.override_changed", {
        detail: { itemId: "sample.item", changedFields: "label,visible", ignored: "secret" },
      }),
      event(2, "member.invited", { detail: { role: "tenant_admin", email: "hidden@example.test" } }),
      event(3, "domain_metadata.changed", {
        detail: {
          changedKeys: "displayLabel,verificationNote",
          displayLabel: "caller supplied",
          verificationNote: "do not show",
        },
      }),
      event(4, "module.access_mode_changed", {
        detail: { mode: "passcode", passcodeRotated: true, supportReason: "private" },
      }),
      event(5, "brand.voice_profile.published", {
        detail: { version: 3, digest: "hidden", reason: "private" },
      }),
      event(6, "support.policy_changed", { detail: { enabled: true } }),
      event(7, "module_metadata.changed", {
        detail: {
          changedKeys: "displayLabel,supportNote",
          displayLabel: "caller supplied",
          supportNote: "do not show",
        },
      }),
    ], TENANT_ID);

    expect(records).toHaveLength(7);
    expect(records.map((record) => record.action)).toEqual([
      "module_metadata.changed",
      "support.policy_changed",
      "brand.voice_profile.published",
      "module.access_mode_changed",
      "domain_metadata.changed",
      "member.invited",
      "navigation.override_changed",
    ]);
    expect(records.map((record) => record.metadata)).toEqual([
      { changedKeys: "displayLabel,supportNote" },
      { enabled: true },
      { version: 3 },
      { mode: "passcode", passcodeRotated: true },
      { changedKeys: "displayLabel,verificationNote" },
      { role: "tenant_admin" },
      { itemId: "sample.item", changedFields: "label,visible" },
    ]);
    expect(Object.keys(records[0]!)).toEqual([
      "sequence",
      "occurredAt",
      "actor",
      "action",
      "subject",
      "summary",
      "metadata",
    ]);
  });

  it("omits platform, other-tenant and unknown events without leaking their count or content", () => {
    const hostileDetail = {
      credential: "Bearer credential-value",
      secret: "secret-value",
      providerSubject: "provider-user-other",
      prompt: "private prompt",
    };
    const visible = event(7, "tenant.provisioned", { subject: "example-tenant" });
    const mixed = [
      event(99, "member.invited", {
        tenantId: "tenant-other",
        actor: { kind: "user", userId: "other-actor" },
        subject: "other-subject",
        detail: { role: "tenant_owner", ...hostileDetail },
      }),
      event(100, "support.policy_changed", {
        tenantId: null,
        actor: { kind: "system", job: "platform-secret-job" },
        subject: "platform-subject",
        detail: { enabled: false, ...hostileDetail },
      }),
      event(101, "unknown.credentials_rotated", { detail: hostileDetail }),
      visible,
    ];

    const result = projectTenantActivity(mixed, TENANT_ID);
    expect(result).toHaveLength(1);
    expect(result[0]?.subject).toBe("example-tenant");
    expect(JSON.stringify(result)).not.toMatch(
      /other-|platform-|credential-value|secret-value|private prompt/u,
    );
  });

  it("copies only explicit primitive metadata and rejects hostile values even on allowed keys", () => {
    const oversized = "x".repeat(20_000);
    const detail = {
      mode: { nested: "passcode", token: "secret" },
      passcodeRotated: true,
      url: "https://credentials.example.test/callback?token=secret",
      connectionLocator: "postgres://user:password@example.test/database",
      providerId: "provider-secret",
      token: "secret-token",
      prompt: "system prompt",
      modelOutput: oversized,
      rawError: "stack and private data",
      freeText: oversized,
    } as unknown as AuditEvent["detail"];

    const [record] = projectTenantActivity([
      event(1, "module.access_mode_changed", { detail }),
    ], TENANT_ID);
    expect(record?.metadata).toEqual({ passcodeRotated: true });
    expect(JSON.stringify(record)).not.toMatch(
      /nested|token|https:|postgres:|provider-secret|system prompt|modelOutput|rawError/u,
    );
  });

  it("uses bounded actor displays without identity attributes", () => {
    const records = projectTenantActivity([
      event(1, "tenant.provisioned", {
        actor: { kind: "user", userId: "provider|person@example.test" },
      }),
      event(2, "tenant.provisioned", {
        actor: { kind: "system", job: "sync-provider-tenant-other" },
      }),
      event(3, "brand.overrides_changed", {
        actor: { kind: "installation_owner", userId: "owner@example.test" },
        detail: { changedKeys: "logoUrl" },
      }),
      event(4, "support.policy_changed", {
        actor: { kind: "platform_admin", userId: "admin@example.test" },
        detail: { enabled: true, supportSessionId: "support-other-tenant" },
      }),
      event(5, "tenant.provisioned", {
        actor: { kind: "alien", email: "malformed@example.test" } as never,
      }),
      event(6, "tenant.provisioned", { actor: null as never }),
    ], TENANT_ID);

    expect(records.map((record) => record.actor)).toEqual([
      "Unknown actor",
      "Unknown actor",
      "Platform operator",
      "Support operator",
      "System",
      "Tenant user",
    ]);
    expect(JSON.stringify(records)).not.toMatch(/@example\.test|provider\||tenant-other/u);
  });

  it("shows only bounded identifier-shaped subjects", () => {
    const records = projectTenantActivity([
      event(1, "tenant.provisioned", { subject: "tenant-safe_1:active" }),
      event(2, "tenant.provisioned", {
        subject: "https://credentials.example.test/path?token=secret",
      }),
      event(3, "tenant.provisioned", { subject: "person@example.test" }),
      event(4, "tenant.provisioned", { subject: "x".repeat(201) }),
    ], TENANT_ID);

    expect(records.map((record) => record.subject)).toEqual([
      "Affected resource",
      "Affected resource",
      "Affected resource",
      "tenant-safe_1:active",
    ]);
    expect(JSON.stringify(records)).not.toMatch(/credentials|token=secret|@example\.test/u);
  });

  it("sorts newest-first, clamps limits to 1..100 and is byte-stable", () => {
    const events = Array.from({ length: 105 }, (_, index) =>
      event(index + 1, "tenant.provisioned", {
        occurredAt: new Date(1_700_000_000_000 + index * 1_000),
      }),
    );
    const maximum = projectTenantActivity(events, TENANT_ID, 1_000);
    expect(maximum).toHaveLength(100);
    expect(maximum[0]?.sequence).toBe(105);
    expect(maximum.at(-1)?.sequence).toBe(6);
    expect(projectTenantActivity(events, TENANT_ID, 0)).toHaveLength(1);
    expect(projectTenantActivity(events, TENANT_ID, -10)).toHaveLength(1);
    expect(JSON.stringify(projectTenantActivity(events, TENANT_ID, 20))).toBe(
      JSON.stringify(projectTenantActivity([...events].reverse(), TENANT_ID, 20)),
    );
  });

  it("returns frozen defensive snapshots unaffected by later input mutation", () => {
    const mutableDetail: Record<string, string | number | boolean | null> = {
      role: "tenant_admin",
    };
    const input = event(1, "member.invited", { detail: mutableDetail });
    const records = projectTenantActivity([input], TENANT_ID);
    const before = JSON.stringify(records);

    mutableDetail.role = "tenant_owner";
    input.subject = "changed-subject";
    input.occurredAt.setUTCFullYear(2030);

    expect(JSON.stringify(records)).toBe(before);
    expect(Object.isFrozen(records)).toBe(true);
    expect(Object.isFrozen(records[0])).toBe(true);
    expect(Object.isFrozen(records[0]?.metadata)).toBe(true);
  });
  it("discloses navigation identifiers only when the caller supplies the installed ID", () => {
    const events = [event(1, "navigation.override_changed", { detail: { itemId: "sample.item", changedFields: "label" } })];
    expect(projectActivity(events, TENANT_ID)[0]?.metadata).toEqual({ changedFields: "label" });
    expect(projectActivity(events, TENANT_ID, 100, ["sample.item"])[0]?.metadata).toEqual({ itemId: "sample.item", changedFields: "label" });
  });

});
