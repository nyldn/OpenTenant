import { beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({
  createOrganization: vi.fn(),
  deleteOrganization: vi.fn(),
  listInvitations: vi.fn(),
  sendInvitation: vi.fn(),
}));

vi.mock("@workos-inc/node", () => ({
  WorkOS: class {
    readonly organizations = provider;
    readonly userManagement = provider;
  },
}));

import { createWorkOSPort } from "./sdk";

function page<T>(data: T[]) {
  return { data: data.slice(0, 1), autoPagination: async () => data };
}

describe("WorkOS organization provisioning port", () => {
  beforeEach(() => {
    provider.createOrganization.mockReset();
    provider.deleteOrganization.mockReset();
    provider.listInvitations.mockReset();
    provider.sendInvitation.mockReset();
  });

  it("normalizes organization creation to an external id", async () => {
    provider.createOrganization.mockResolvedValue({ id: "workos_org_created" });
    const port = createWorkOSPort({
      apiKey: "test-api-key",
      clientId: "test-client-id",
      cookiePassword: "test-cookie-password-that-is-long-enough",
      redirectUri: "https://app.example.test/auth/callback",
    });

    await expect(port.createOrganization("Example Organisation")).resolves.toBe(
      "workos_org_created",
    );
    expect(provider.createOrganization).toHaveBeenCalledWith({
      name: "Example Organisation",
    });
  });

  it.each([
    ["missing", {}],
    ["empty", { id: "" }],
    ["whitespace", { id: "   " }],
    ["unbounded", { id: "a".repeat(256) }],
    ["hostile characters", { id: "org_<script>" }],
  ])("rejects a %s organization id response", async (_label, response) => {
    provider.createOrganization.mockResolvedValue(response);
    const port = createWorkOSPort({
      apiKey: "test-api-key",
      clientId: "test-client-id",
      cookiePassword: "test-cookie-password-that-is-long-enough",
      redirectUri: "https://app.example.test/auth/callback",
    });

    await expect(port.createOrganization("Example Organisation")).rejects.toThrow(
      "WorkOS returned an invalid organization response",
    );
  });

  it("passes compensating deletion through the port", async () => {
    provider.deleteOrganization.mockResolvedValue(undefined);
    const port = createWorkOSPort({
      apiKey: "test-api-key",
      clientId: "test-client-id",
      cookiePassword: "test-cookie-password-that-is-long-enough",
      redirectUri: "https://app.example.test/auth/callback",
    });

    await expect(port.deleteOrganization("workos_org_created")).resolves.toBeUndefined();
    expect(provider.deleteOrganization).toHaveBeenCalledWith("workos_org_created");
  });

  it("reuses a pending invitation for the same normalized email and organization", async () => {
    provider.listInvitations.mockResolvedValue(page([{
        id: "workos_invitation_existing",
        email: "invitee@example.test",
        state: "pending",
        roleSlug: "member",
      }]));
    const port = createWorkOSPort({
      apiKey: "test-api-key",
      clientId: "test-client-id",
      cookiePassword: "test-cookie-password-that-is-long-enough",
      redirectUri: "https://app.example.test/auth/callback",
    });

    await expect(
      port.sendInvitation(" Invitee@Example.Test ", "workos_org_example", "member"),
    ).resolves.toBe("workos_invitation_existing");
    expect(provider.listInvitations).toHaveBeenCalledWith({
      organizationId: "workos_org_example",
      email: "invitee@example.test",
    });
    expect(provider.sendInvitation).not.toHaveBeenCalled();
  });

  it("fails closed when a pending invitation has a different provider role", async () => {
    provider.listInvitations.mockResolvedValue(page([{
        id: "workos_invitation_privileged",
        email: "invitee@example.test",
        state: "pending",
        roleSlug: "tenant-admin",
      }]));
    const port = createWorkOSPort({
      apiKey: "test-api-key",
      clientId: "test-client-id",
      cookiePassword: "test-cookie-password-that-is-long-enough",
      redirectUri: "https://app.example.test/auth/callback",
    });

    const error = await port
      .sendInvitation(" Invitee@Example.Test ", "workos_org_example", "member")
      .catch((caught: unknown) => caught);

    expect(error).toEqual(new Error("WorkOS invitation operation failed"));
    expect(String(error)).not.toContain("workos_invitation_privileged");
    expect(provider.sendInvitation).not.toHaveBeenCalled();
  });

  it("sends an invitation when no pending normalized email match exists", async () => {
    provider.listInvitations.mockResolvedValue(page([]));
    provider.sendInvitation.mockResolvedValue({ id: "workos_invitation_created" });
    const port = createWorkOSPort({
      apiKey: "test-api-key",
      clientId: "test-client-id",
      cookiePassword: "test-cookie-password-that-is-long-enough",
      redirectUri: "https://app.example.test/auth/callback",
    });

    await expect(
      port.sendInvitation("Invitee@Example.Test", "workos_org_example", "tenant-admin"),
    ).resolves.toBe("workos_invitation_created");
    expect(provider.sendInvitation).toHaveBeenCalledWith({
      email: "invitee@example.test",
      organizationId: "workos_org_example",
      roleSlug: "tenant-admin",
    });
  });

  it("redacts provider details when an invitation operation fails", async () => {
    provider.listInvitations.mockRejectedValue(
      new Error("synthetic-provider-secret and response body"),
    );
    const port = createWorkOSPort({
      apiKey: "test-api-key",
      clientId: "test-client-id",
      cookiePassword: "test-cookie-password-that-is-long-enough",
      redirectUri: "https://app.example.test/auth/callback",
    });

    const error = await port
      .sendInvitation("invitee@example.test", "workos_org_example", "member")
      .catch((caught: unknown) => caught);

    expect(error).toEqual(new Error("WorkOS invitation operation failed"));
    expect(String(error)).not.toContain("synthetic-provider-secret");
  });

  it("reads invitations past the first provider page", async () => {
    provider.listInvitations.mockResolvedValue(page([
      { id: "workos_invitation_first", email: "first@example.test", state: "pending", roleSlug: "member" },
      { id: "workos_invitation_second", email: "second@example.test", state: "pending", roleSlug: "member" },
    ]));
    const port = createWorkOSPort({
      apiKey: "test-api-key",
      clientId: "test-client-id",
      cookiePassword: "test-cookie-password-that-is-long-enough",
      redirectUri: "https://app.example.test/auth/callback",
    });

    const invitations = await port.listInvitationsForOrganization("workos_org_example");

    expect(invitations.map((invitation) => invitation.externalInvitationId)).toEqual([
      "workos_invitation_first",
      "workos_invitation_second",
    ]);
  });
});
