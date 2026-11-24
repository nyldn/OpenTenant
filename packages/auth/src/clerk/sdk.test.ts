import { beforeEach, describe, expect, it, vi } from "vitest";

const backendMocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  createClerkClient: vi.fn(),
}));

vi.mock("@clerk/backend", () => backendMocks);

import type { ClerkClient } from "@clerk/backend";
import {
  clerkConfigFromEnv,
  createClerkPort,
  type ClerkSdkConfig,
} from "./sdk";

const config: ClerkSdkConfig = {
  secretKey: "unit-test-secret-value",
  publishableKey: "unit-test-publishable-value",
  issuer: "https://issuer.example.test",
  authorizedParties: ["https://tenant.example.test"],
  audience: ["opentenant-test"],
};

function claims(overrides: Record<string, unknown> = {}) {
  return {
    __raw: "unit-test-token",
    iss: config.issuer,
    sub: "clerk_user_example",
    sid: "clerk_session_example",
    nbf: 1,
    exp: 2_000_000_000,
    iat: 1,
    org_id: "clerk_org_example",
    org_role: "org:tenant_owner",
    org_permissions: ["org:brain:promote"],
    ...overrides,
  };
}

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: "clerk_membership_example",
    role: "org:tenant_owner",
    permissions: ["org:brain:promote"],
    organization: { id: "clerk_org_example" },
    publicUserData: {
      userId: "clerk_user_example",
      identifier: "member@example.test",
      firstName: "Member",
      lastName: "Example",
    },
    ...overrides,
  };
}

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: "clerk_invitation_example",
    organizationId: "clerk_org_example",
    emailAddress: "invitee@example.test",
    role: "org:member",
    status: "pending",
    ...overrides,
  };
}

function createFakeClient() {
  return {
    sessions: {
      getSession: vi.fn().mockResolvedValue({
        id: "clerk_session_example",
        userId: "clerk_user_example",
        status: "active",
        expireAt: 2_000_000_000_000,
        lastActiveOrganizationId: "clerk_org_example",
        actor: null,
      }),
      revokeSession: vi.fn().mockResolvedValue({ id: "clerk_session_example" }),
    },
    users: {
      getUser: vi.fn().mockResolvedValue({
        id: "clerk_user_example",
        primaryEmailAddressId: "email_primary",
        emailAddresses: [{ id: "email_primary", emailAddress: "member@example.test" }],
        firstName: "Member",
        lastName: "Example",
      }),
      getOrganizationMembershipList: vi.fn().mockResolvedValue({
        data: [membership()],
        totalCount: 1,
      }),
    },
    organizations: {
      createOrganization: vi.fn().mockResolvedValue({ id: "clerk_org_created" }),
      deleteOrganization: vi.fn().mockResolvedValue({ id: "clerk_org_example" }),
      getOrganizationMembershipList: vi.fn().mockResolvedValue({
        data: [membership()],
        totalCount: 1,
      }),
      getOrganizationInvitationList: vi.fn().mockResolvedValue({
        data: [],
        totalCount: 0,
      }),
      createOrganizationInvitation: vi.fn().mockResolvedValue(invitation()),
      revokeOrganizationInvitation: vi.fn().mockResolvedValue(invitation({ status: "revoked" })),
      updateOrganizationMembership: vi.fn().mockImplementation(
        async ({ role }: { role: string }) => membership({ role }),
      ),
      deleteOrganizationMembership: vi.fn().mockResolvedValue(membership()),
    },
  };
}

describe("Clerk SDK configuration", () => {
  it("requires and normalizes explicit server configuration", () => {
    expect(clerkConfigFromEnv({
      CLERK_SECRET_KEY: "unit-test-secret-value",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "unit-test-publishable-value",
      CLERK_JWT_ISSUER: "https://issuer.example.test/",
      CLERK_AUTHORIZED_PARTIES: " https://tenant.example.test, http://localhost:3000 ",
      CLERK_JWT_AUDIENCE: "opentenant-test, secondary-test",
    })).toEqual({
      secretKey: "unit-test-secret-value",
      publishableKey: "unit-test-publishable-value",
      issuer: "https://issuer.example.test",
      authorizedParties: ["https://tenant.example.test", "http://localhost:3000"],
      audience: ["opentenant-test", "secondary-test"],
    });
  });

  it("accepts the framework-neutral publishable key emitted by Clerk CLI", () => {
    expect(clerkConfigFromEnv({
      CLERK_SECRET_KEY: "unit-test-secret-value",
      CLERK_PUBLISHABLE_KEY: "unit-test-cli-publishable-value",
      CLERK_JWT_ISSUER: "https://issuer.example.test",
      CLERK_AUTHORIZED_PARTIES: "http://localhost:3000",
      CLERK_JWT_AUDIENCE: "opentenant-test",
    }).publishableKey).toBe("unit-test-cli-publishable-value");
  });

  it("rejects missing or unsafe configuration without reflecting values", () => {
    expect(() => clerkConfigFromEnv({})).toThrow("Incomplete Clerk configuration");
    const unsafe = "http://not-loopback.example.test";
    let message = "";
    try {
      clerkConfigFromEnv({
        CLERK_SECRET_KEY: "unit-test-secret-value",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "unit-test-publishable-value",
        CLERK_JWT_ISSUER: "https://issuer.example.test",
        CLERK_AUTHORIZED_PARTIES: unsafe,
        CLERK_JWT_AUDIENCE: "opentenant-test",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("Invalid Clerk configuration");
    expect(message).not.toContain(unsafe);
  });

  it("requires an explicit intended audience", () => {
    expect(() => clerkConfigFromEnv({
      CLERK_SECRET_KEY: "unit-test-secret-value",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "unit-test-publishable-value",
      CLERK_JWT_ISSUER: "https://issuer.example.test",
      CLERK_AUTHORIZED_PARTIES: "https://tenant.example.test",
    })).toThrow("Incomplete Clerk configuration");
  });
});

describe("Clerk SDK port", () => {
  let client: ReturnType<typeof createFakeClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createFakeClient();
    backendMocks.createClerkClient.mockReturnValue(client as unknown as ClerkClient);
    backendMocks.verifyToken.mockResolvedValue(claims());
  });

  it("verifies exact token options, issuer, active session, and normalized profile", async () => {
    const port = createClerkPort(config);

    await expect(port.authenticateSession("unit-test-token")).resolves.toEqual({
      status: "authenticated",
      session: {
        externalSessionId: "clerk_session_example",
        externalSubject: "clerk_user_example",
        externalOrganizationId: "clerk_org_example",
        email: "member@example.test",
        displayName: "Member Example",
        impersonated: false,
        role: "org:tenant_owner",
        permissions: ["org:brain:promote"],
        expiresAt: new Date(2_000_000_000_000),
      },
    });
    expect(backendMocks.verifyToken).toHaveBeenCalledWith("unit-test-token", {
      secretKey: config.secretKey,
      authorizedParties: config.authorizedParties,
      audience: config.audience,
    });
    expect(client.sessions.getSession).toHaveBeenCalledWith("clerk_session_example");
  });

  it("extracts version 2 organization role and custom permissions", async () => {
    backendMocks.verifyToken.mockResolvedValue(claims({
      v: 2,
      org_id: undefined,
      org_role: undefined,
      org_permissions: undefined,
      fea: "o:brain,u:personal",
      o: { id: "clerk_org_example", rol: "tenant_owner", per: "promote", fpm: "1" },
    }));

    const port = createClerkPort(config);

    await expect(port.authenticateSession("unit-test-token")).resolves.toMatchObject({
      status: "authenticated",
      session: {
        externalOrganizationId: "clerk_org_example",
        role: "org:tenant_owner",
        permissions: ["org:brain:promote"],
      },
    });
  });

  it("accepts an organization session with no custom permissions", async () => {
    backendMocks.verifyToken.mockResolvedValue(claims({ org_permissions: undefined }));
    const port = createClerkPort(config);

    await expect(port.authenticateSession("unit-test-token")).resolves.toMatchObject({
      status: "authenticated",
      session: { permissions: [] },
    });
  });

  it("does not report a session lifetime beyond the verified token", async () => {
    backendMocks.verifyToken.mockResolvedValue(claims({ exp: 1_900_000_000 }));
    const port = createClerkPort(config);

    await expect(port.authenticateSession("unit-test-token")).resolves.toMatchObject({
      status: "authenticated",
      session: { expiresAt: new Date(1_900_000_000_000) },
    });
  });

  it("uses the verified per-tab organization claim instead of session switch history", async () => {
    client.sessions.getSession.mockResolvedValueOnce({
      id: "clerk_session_example",
      userId: "clerk_user_example",
      status: "active",
      expireAt: 2_000_000_000_000,
      lastActiveOrganizationId: "clerk_org_from_another_tab",
      actor: null,
    });
    const port = createClerkPort(config);

    await expect(port.authenticateSession("unit-test-token")).resolves.toMatchObject({
      status: "authenticated",
      session: { externalOrganizationId: "clerk_org_example" },
    });
  });

  it("fails closed for issuer, session, and provider object mismatches", async () => {
    backendMocks.verifyToken.mockResolvedValueOnce(claims({ iss: "https://other.example.test" }));
    const port = createClerkPort(config);
    await expect(port.authenticateSession("issuer-mismatch")).resolves.toEqual({ status: "invalid" });

    backendMocks.verifyToken.mockResolvedValueOnce(claims());
    client.sessions.getSession.mockResolvedValueOnce({
      id: "clerk_session_example",
      userId: "clerk_user_example",
      status: "revoked",
      expireAt: 2_000_000_000_000,
      lastActiveOrganizationId: "clerk_org_example",
      actor: null,
    });
    await expect(port.authenticateSession("inactive-session")).resolves.toEqual({ status: "invalid" });

    backendMocks.verifyToken.mockResolvedValueOnce(claims());
    client.users.getUser.mockResolvedValueOnce({ id: "clerk_user_example", emailAddresses: [] });
    await expect(port.authenticateSession("invalid-user")).resolves.toEqual({ status: "invalid" });
  });

  it("distinguishes an expired token without exposing provider errors", async () => {
    backendMocks.verifyToken.mockRejectedValueOnce({
      reason: "token-expired",
      message: "synthetic-sensitive-provider-text",
    });
    const port = createClerkPort(config);

    await expect(port.authenticateSession("expired-token")).resolves.toEqual({ status: "expired" });

    backendMocks.verifyToken.mockRejectedValueOnce(new Error("synthetic-sensitive-provider-text"));
    await expect(port.authenticateSession("invalid-token")).resolves.toEqual({ status: "invalid" });
  });

  it("reads all membership pages and validates their subject and organization", async () => {
    client.users.getOrganizationMembershipList.mockImplementation(async ({ offset }: { offset: number }) => ({
      data: [membership({
        id: offset === 0 ? "membership_page_one" : "membership_page_two",
      })],
      totalCount: 2,
    }));
    client.organizations.getOrganizationMembershipList.mockImplementation(
      async ({ offset }: { offset: number }) => ({
        data: [membership({
          id: offset === 0 ? "membership_page_one" : "membership_page_two",
        })],
        totalCount: 2,
      }),
    );
    const port = createClerkPort(config);

    await expect(port.listMembershipsForUser("clerk_user_example")).resolves.toHaveLength(2);
    await expect(port.listMembershipsForOrganization("clerk_org_example")).resolves.toHaveLength(2);
    expect(client.users.getOrganizationMembershipList).toHaveBeenLastCalledWith({
      userId: "clerk_user_example",
      limit: 100,
      offset: 1,
    });
    expect(client.organizations.getOrganizationMembershipList).toHaveBeenLastCalledWith({
      organizationId: "clerk_org_example",
      limit: 100,
      offset: 1,
    });
  });

  it("rejects duplicate resource IDs across pagination pages", async () => {
    client.users.getOrganizationMembershipList.mockImplementation(async () => ({
      data: [membership({ id: "membership_repeated" })],
      totalCount: 2,
    }));
    const port = createClerkPort(config);

    await expect(port.listMembershipsForUser("clerk_user_example")).rejects.toThrow(
      "Clerk membership operation failed",
    );
  });

  it("reuses a matching pending invitation found on a later page", async () => {
    client.organizations.getOrganizationInvitationList.mockImplementation(
      async ({ offset }: { offset: number }) => ({
        data: [offset === 0
          ? invitation({ id: "other_invitation", emailAddress: "other@example.test" })
          : invitation({ emailAddress: " INVITEE@example.test " })],
        totalCount: 2,
      }),
    );
    const port = createClerkPort(config);

    await expect(port.sendInvitation(
      "invitee@example.test",
      "clerk_org_example",
      "org:member",
    )).resolves.toBe("clerk_invitation_example");
    expect(client.organizations.createOrganizationInvitation).not.toHaveBeenCalled();
  });

  it("fails closed when a pending invitation has a different provider role", async () => {
    client.organizations.getOrganizationInvitationList.mockResolvedValue({
      data: [invitation({
        id: "clerk_invitation_privileged",
        role: "org:tenant_admin",
      })],
      totalCount: 1,
    });
    const port = createClerkPort(config);

    let error: unknown;
    try {
      await port.sendInvitation(
        " INVITEE@example.test ",
        "clerk_org_example",
        "org:member",
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toEqual(new Error("Clerk invitation operation failed"));
    expect(String(error)).not.toContain("clerk_invitation_privileged");
    expect(client.organizations.createOrganizationInvitation).not.toHaveBeenCalled();
  });

  it("rejects invitation records from another organization", async () => {
    client.organizations.getOrganizationInvitationList.mockResolvedValue({
      data: [invitation({ organizationId: "clerk_org_other" })],
      totalCount: 1,
    });
    const port = createClerkPort(config);

    await expect(port.listInvitationsForOrganization("clerk_org_example")).rejects.toThrow(
      "Clerk invitation operation failed",
    );
  });

  it("rejects malformed membership roles and wrong-subject records", async () => {
    const port = createClerkPort(config);
    client.users.getOrganizationMembershipList.mockResolvedValueOnce({
      data: [membership({ publicUserData: {
        userId: "clerk_user_other",
        identifier: "other@example.test",
        firstName: null,
        lastName: null,
      } })],
      totalCount: 1,
    });
    await expect(port.listMembershipsForUser("clerk_user_example")).rejects.toThrow(
      "Clerk membership operation failed",
    );

    client.users.getOrganizationMembershipList.mockResolvedValueOnce({
      data: [membership({ role: "invalid role" })],
      totalCount: 1,
    });
    await expect(port.listMembershipsForUser("clerk_user_example")).rejects.toThrow(
      "Clerk membership operation failed",
    );
  });

  it("uses organization and user keys for membership mutations", async () => {
    const port = createClerkPort(config);

    await port.updateMembershipRole("clerk_org_example", "clerk_user_example", "org:tenant_admin");
    await port.deleteMembership("clerk_org_example", "clerk_user_example");

    expect(client.organizations.updateOrganizationMembership).toHaveBeenCalledWith({
      organizationId: "clerk_org_example",
      userId: "clerk_user_example",
      role: "org:tenant_admin",
    });
    expect(client.organizations.deleteOrganizationMembership).toHaveBeenCalledWith({
      organizationId: "clerk_org_example",
      userId: "clerk_user_example",
    });
  });

  it("validates provider mutation response ownership", async () => {
    const port = createClerkPort(config);
    client.organizations.updateOrganizationMembership.mockResolvedValueOnce(
      membership({ organization: { id: "clerk_org_other" } }),
    );
    await expect(port.updateMembershipRole(
      "clerk_org_example",
      "clerk_user_example",
      "org:tenant_admin",
    )).rejects.toThrow("Clerk membership operation failed");

    client.sessions.revokeSession.mockResolvedValueOnce({ id: "clerk_session_other" });
    await expect(port.revokeSession("unit-test-token")).rejects.toThrow(
      "Clerk session operation failed",
    );
  });

  it("rejects a malformed primary profile email", async () => {
    client.users.getUser.mockResolvedValueOnce({
      id: "clerk_user_example",
      primaryEmailAddressId: "email_primary",
      emailAddresses: [{ id: "email_primary", emailAddress: "not-an-email" }],
      firstName: null,
      lastName: null,
    });
    const port = createClerkPort(config);

    await expect(port.authenticateSession("unit-test-token")).resolves.toEqual({ status: "invalid" });
  });

  it("returns fixed invitation errors without provider response text", async () => {
    client.organizations.createOrganizationInvitation.mockRejectedValueOnce(
      new Error("synthetic-sensitive-provider-text"),
    );
    const port = createClerkPort(config);

    let message = "";
    try {
      await port.sendInvitation("new@example.test", "clerk_org_example", "org:member");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("Clerk invitation operation failed");
    expect(message).not.toContain("synthetic-sensitive-provider-text");
  });

  it("returns a fixed client initialization error", () => {
    backendMocks.createClerkClient.mockImplementationOnce(() => {
      throw new Error("synthetic-sensitive-provider-text");
    });

    let message = "";
    try {
      createClerkPort(config);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("Clerk client initialization failed");
    expect(message).not.toContain("synthetic-sensitive-provider-text");
  });
});
