import { enforceMutationRateLimit } from "../../../../lib/settings-rate-limit";
vi.mock("../../../../lib/settings-rate-limit", () => ({ enforceMutationRateLimit: vi.fn(async () => null) }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantMember } from "@opentenant/auth";

const mocks = vi.hoisted(() => ({
  identityGateway: vi.fn(),
  lockedClient: { query: vi.fn() },
  listTenantMembers: vi.fn(),
  removeMembership: vi.fn(),
  setRole: vi.fn(),
  queueMembershipSync: vi.fn(),
  invite: vi.fn(),
  audit: vi.fn(),
  withTenantMemberMutationLock: vi.fn(),
  session: {
    userId: "usr_admin",
    activeRole: "tenant_owner",
    isPlatformAdmin: false,
  } as { userId: string; activeRole: string; isPlatformAdmin: boolean },
}));

vi.mock("../../../../lib/identity", () => ({
  identityGateway: (client?: unknown) => {
    mocks.identityGateway(client);
    return {
      listTenantMembers: mocks.listTenantMembers,
      removeMembership: mocks.removeMembership,
      setRole: mocks.setRole,
      invite: mocks.invite,
    };
  },
}));
vi.mock("../../../../lib/authz-lifecycle", () => ({ queueMembershipSync: mocks.queueMembershipSync }));
vi.mock("../../../../lib/audit", () => ({ audit: mocks.audit }));
vi.mock("../../../../lib/member-mutation-lock", () => ({
  withTenantMemberMutationLock: mocks.withTenantMemberMutationLock,
}));
vi.mock("../../../../lib/settings-guard", () => ({
  auditActor: () => ({ kind: "user", userId: mocks.session.userId }),
  sameOrigin: () => true,
}));
vi.mock("../../../../lib/tenant-admin", () => ({
  tenantAdminContext: async () => ({
    ok: true,
    context: {
      session: mocks.session,
      tenant: { tenantId: "tenant_example", displayName: "Example" },
      auditActor: { kind: "user", userId: mocks.session.userId },
    },
  }),
}));

import { POST } from "./route";

const member = (overrides: Partial<TenantMember> = {}): TenantMember => ({
  kind: "membership",
  membershipId: "mem_internal_example" as TenantMember["membershipId"],
  userId: "usr_member" as TenantMember["userId"],
  tenantId: "tenant_example" as TenantMember["tenantId"],
  email: "member@example.test",
  displayName: "Example Member",
  role: "tenant_member",
  status: "active",
  ...overrides,
});

function request(body: URLSearchParams): Request {
  return new Request("https://app.example.test/api/settings/members", { method: "POST", body });
}

describe("provider-neutral member administration", () => {
  beforeEach(() => {
    mocks.identityGateway.mockReset();
    mocks.queueMembershipSync.mockReset().mockResolvedValue(undefined);
    mocks.setRole.mockReset().mockResolvedValue(undefined);
    mocks.listTenantMembers.mockReset();
    mocks.removeMembership.mockReset().mockResolvedValue(undefined);
    mocks.invite.mockReset().mockResolvedValue("mem_invited_example");
    mocks.audit.mockReset().mockResolvedValue(undefined);
    mocks.withTenantMemberMutationLock.mockReset().mockImplementation(
      async (_tenantId: string, operation: (client: unknown) => Promise<unknown>) => operation(mocks.lockedClient),
    );
    mocks.session = { userId: "usr_admin", activeRole: "tenant_owner", isPlatformAdmin: false };
  });

  it("removes only a normalized internal membership owned by the active tenant", async () => {
    mocks.listTenantMembers.mockResolvedValue([member()]);

    const response = await POST(request(new URLSearchParams({
      op: "remove",
      membershipId: "mem_internal_example",
    })));

    expect(response.status).toBe(303);
    expect(mocks.identityGateway).toHaveBeenCalledWith(mocks.lockedClient);
    expect(mocks.listTenantMembers).toHaveBeenCalledWith("tenant_example");
    expect(mocks.removeMembership).toHaveBeenCalledWith("mem_internal_example");
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      "tenant_example",
      "member.removed",
      "mem_internal_example",
      { membershipId: "mem_internal_example", role: "tenant_member", status: "active" },
    );
  });

  it("enqueues revocation on the locked mutation client before removal", async () => {
    mocks.listTenantMembers.mockResolvedValue([member()]);
    await POST(request(new URLSearchParams({ op: "remove", membershipId: "mem_internal_example" })));
    expect(mocks.queueMembershipSync).toHaveBeenCalledWith(mocks.lockedClient, {
      tenantId: "tenant_example", userId: "usr_member", role: "tenant_member", active: false,
    });
    expect(mocks.queueMembershipSync).toHaveBeenCalledBefore(mocks.removeMembership);
  });
  it("does not mutate the provider when durable enqueue fails", async () => {
    mocks.listTenantMembers.mockResolvedValue([member()]);
    mocks.queueMembershipSync.mockRejectedValueOnce(new Error("database unavailable"));
    const response = await POST(new Request("https://app.example.test/api/settings/members", {
      method: "POST", headers: { accept: "application/json" }, body: new URLSearchParams({ op: "remove", membershipId: "mem_internal_example" }),
    }));
    expect(response.status).toBe(500);
    expect(mocks.removeMembership).not.toHaveBeenCalled();
  });
  it("queues a role change in the same transaction and retains owner checks", async () => {
    mocks.listTenantMembers.mockResolvedValue([member()]);
    const response = await POST(request(new URLSearchParams({ op: "role", membershipId: "mem_internal_example", role: "tenant_admin" })));
    expect(response.status).toBe(303);
    expect(mocks.queueMembershipSync).toHaveBeenCalledWith(mocks.lockedClient, {
      tenantId: "tenant_example", userId: "usr_member", role: "tenant_admin", active: true,
    });
    expect(mocks.setRole).toHaveBeenCalledWith("mem_internal_example", "tenant_admin");
    mocks.listTenantMembers.mockResolvedValue([member({ role: "tenant_owner" })]);
    expect((await POST(request(new URLSearchParams({ op: "role", membershipId: "mem_internal_example", role: "tenant_member" })))).status).toBe(403);
  });

  it("does not treat an external-looking provider ID as authorization", async () => {
    mocks.listTenantMembers.mockResolvedValue([member()]);

    const response = await POST(request(new URLSearchParams({ op: "remove", membershipId: "om_external" })));

    expect(response.status).toBe(404);
    expect(mocks.removeMembership).not.toHaveBeenCalled();
  });

  it("fails closed if a normalized result is bound to another tenant", async () => {
    mocks.listTenantMembers.mockResolvedValue([member({
      tenantId: "tenant_other" as TenantMember["tenantId"],
    })]);

    const response = await POST(request(new URLSearchParams({
      op: "remove",
      membershipId: "mem_internal_example",
    })));

    expect(response.status).toBe(404);
    expect(mocks.removeMembership).not.toHaveBeenCalled();
  });

  it("does not let a foreign-tenant owner defeat last-owner protection", async () => {
    mocks.listTenantMembers.mockResolvedValue([
      member({ role: "tenant_owner" }),
      member({
        membershipId: "mem_foreign_owner" as TenantMember["membershipId"],
        tenantId: "tenant_other" as TenantMember["tenantId"],
        role: "tenant_owner",
      }),
    ]);

    const response = await POST(request(new URLSearchParams({
      op: "remove",
      membershipId: "mem_internal_example",
    })));

    expect(response.status).toBe(404);
    expect(mocks.removeMembership).not.toHaveBeenCalled();
  });

  it("protects the last canonical tenant owner", async () => {
    mocks.listTenantMembers.mockResolvedValue([member({ role: "tenant_owner" })]);

    const response = await POST(request(new URLSearchParams({
      op: "remove",
      membershipId: "mem_internal_example",
    })));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("error=last_owner");
    expect(mocks.removeMembership).not.toHaveBeenCalled();
  });

  it.each(["invited", "suspended"] as const)(
    "does not count co-owner status %s as active",
    async (status) => {
      mocks.listTenantMembers.mockResolvedValue([
        member({ role: "tenant_owner" }),
        member({
          membershipId: `mem_${status}_owner` as TenantMember["membershipId"],
          role: "tenant_owner",
          status,
        }),
      ]);

      const response = await POST(request(new URLSearchParams({
        op: "remove",
        membershipId: "mem_internal_example",
      })));

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain("error=last_owner");
      expect(mocks.removeMembership).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    },
  );

  it("removes an active owner when another same-tenant active owner remains", async () => {
    mocks.listTenantMembers.mockResolvedValue([
      member({ role: "tenant_owner" }),
      member({
        membershipId: "mem_other_active_owner" as TenantMember["membershipId"],
        role: "tenant_owner",
        status: "active",
      }),
    ]);

    const response = await POST(request(new URLSearchParams({
      op: "remove",
      membershipId: "mem_internal_example",
    })));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/settings/members");
    expect(mocks.removeMembership).toHaveBeenCalledExactlyOnceWith("mem_internal_example");
    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      "tenant_example",
      "member.removed",
      "mem_internal_example",
      { membershipId: "mem_internal_example", role: "tenant_owner", status: "active" },
    );
  });

  it("serializes concurrent owner removals so both active owners cannot be removed", async () => {
    let currentMembers = [
      member({ role: "tenant_owner" }),
      member({
        membershipId: "mem_other_active_owner" as TenantMember["membershipId"],
        userId: "usr_other_owner" as TenantMember["userId"],
        role: "tenant_owner",
      }),
    ];
    mocks.listTenantMembers.mockImplementation(async () => currentMembers.map((entry) => ({ ...entry })));
    mocks.removeMembership.mockImplementation(async (membershipId: string) => {
      currentMembers = currentMembers.filter((entry) => entry.membershipId !== membershipId);
    });

    const tails = new Map<string, Promise<void>>();
    mocks.withTenantMemberMutationLock.mockImplementation(
      async (lockedTenantId: string, operation: (client: unknown) => Promise<unknown>) => {
        const previous = tails.get(lockedTenantId) ?? Promise.resolve();
        let unlock = (): void => undefined;
        const current = new Promise<void>((resolve) => {
          unlock = resolve;
        });
        tails.set(lockedTenantId, current);
        await previous;
        try {
          return await operation(mocks.lockedClient);
        } finally {
          unlock();
          if (tails.get(lockedTenantId) === current) tails.delete(lockedTenantId);
        }
      },
    );

    const [first, second] = await Promise.all([
      POST(request(new URLSearchParams({
        op: "remove",
        membershipId: "mem_internal_example",
      }))),
      POST(request(new URLSearchParams({
        op: "remove",
        membershipId: "mem_other_active_owner",
      }))),
    ]);

    expect([first.headers.get("location"), second.headers.get("location")].sort()).toEqual([
      "https://app.example.test/settings/members",
      "https://app.example.test/settings/members?error=last_owner",
    ]);
    expect(mocks.removeMembership).toHaveBeenCalledTimes(1);
    expect(currentMembers).toHaveLength(1);
    expect(mocks.withTenantMemberMutationLock).toHaveBeenCalledTimes(2);
  });

  it("audits invitations with only the internal membership and canonical role", async () => {
    const response = await POST(request(new URLSearchParams({
      op: "invite",
      email: "new.member@example.test",
      role: "tenant_admin",
    })));

    expect(response.status).toBe(303);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      "tenant_example",
      "member.invited",
      "mem_invited_example",
      { membershipId: "mem_invited_example", role: "tenant_admin" },
    );
    expect(mocks.withTenantMemberMutationLock).not.toHaveBeenCalled();
  });

  it("records the invite attempt before contacting the provider", async () => {
    mocks.audit.mockClear();
    mocks.invite.mockClear();
    const response = await POST(request(new URLSearchParams({ op: "invite", email: "member@example.test" })));
    expect(response.status).toBe(303);
    expect(mocks.audit).toHaveBeenNthCalledWith(1, expect.anything(), "tenant_example", "member.invite_requested", "tenant_example", { role: "tenant_member" });
    expect(mocks.audit).toHaveBeenCalledBefore(mocks.invite);
  });

  it("does not create an invite if the attempt audit fails", async () => {
    mocks.audit.mockReset().mockRejectedValue(new Error("database unavailable"));
    mocks.invite.mockClear();
    const response = await POST(request(new URLSearchParams({ op: "invite", email: "member@example.test" })));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("error=invite");
    expect(mocks.invite).not.toHaveBeenCalled();
  });

  it("normalizes provider invite errors without exposing provider details", async () => {
    mocks.audit.mockReset().mockResolvedValue(undefined);
    mocks.invite.mockRejectedValueOnce(new Error("sensitive provider diagnostic"));
    const response = await POST(request(new URLSearchParams({ op: "invite", email: "member@example.test" })));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/settings/members?error=invite");
    expect(await response.text()).not.toContain("sensitive");
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), "tenant_example", "member.invite_requested", "tenant_example", { role: "tenant_member" });
  });

  it("retains a durable attempt if the completion audit fails", async () => {
    mocks.invite.mockResolvedValue("mem_invited_example");
    mocks.audit.mockReset().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("database unavailable"));
    const response = await POST(request(new URLSearchParams({ op: "invite", email: "member@example.test" })));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("error=invite");
    expect(mocks.audit).toHaveBeenCalledBefore(mocks.invite);
  });

it("explains owner-removal denial without removing an owner", async () => {
  mocks.session.activeRole = "tenant_admin";
  mocks.listTenantMembers.mockResolvedValue([member({ role: "tenant_owner" })]);
  const result = await POST(new Request("https://app.example.test/api/settings/members", {
    method: "POST", headers: { accept: "application/json" }, body: new URLSearchParams({ op: "remove", membershipId: "mem_internal_example" }),
  }));
  expect(result.status).toBe(403);
  expect(await result.json()).toEqual({ status: "error", message: "Only a tenant owner can remove another owner." });
  expect(mocks.removeMembership).not.toHaveBeenCalled();
});

});


describe("member route rate limit boundary", () => {
  it("returns 429 before reading the mutation body", async () => {
    vi.mocked(enforceMutationRateLimit).mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "Retry-After": "12" } }));
    const request = new Request("https://example.test/api/settings/members", { method: "POST", body: "op=invite&email=member@example.test" });
    const response = await POST(request);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("12");
    expect(request.bodyUsed).toBe(false);
  });
});
