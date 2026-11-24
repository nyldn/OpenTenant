import { describe, expect, it, vi } from "vitest";
import { NeonProvisioner } from "./neon";

function providerConnectionUri(query: string): string {
  const uri = new URL("postgresql://ep-test.us-east-1.aws.neon.tech/neondb");
  uri.username = "owner";
  uri.password = "fixture-password";
  uri.search = query;
  return uri.toString();
}

describe("NeonProvisioner connection security", () => {
  it("upgrades provider sslmode=require URIs to hostname-verifying TLS", async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({
        project: { id: "project_test" },
        connection_uris: [{
          connection_uri: providerConnectionUri("sslmode=require&channel_binding=require"),
        }],
      }),
      { status: 201 },
    ));
    const neon = new NeonProvisioner(
      { apiKey: "test-key", orgId: "test-org" },
      fetchImpl as typeof fetch,
    );

    const project = await neon.createTenantProject("example", "us");
    const uri = new URL(project.connectionUri);

    expect(uri.searchParams.get("sslmode")).toBe("verify-full");
    expect(uri.searchParams.get("channel_binding")).toBe("require");
  });

  it("also upgrades resume-path connection URIs", async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({
        uri: providerConnectionUri("sslmode=require"),
      }),
      { status: 200 },
    ));
    const neon = new NeonProvisioner(
      { apiKey: "test-key", orgId: "test-org" },
      fetchImpl as typeof fetch,
    );

    const uri = new URL(await neon.getConnectionUri("project_test"));

    expect(uri.searchParams.get("sslmode")).toBe("verify-full");
  });

  it("rejects malformed provider URIs without returning their contents", async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ uri: "not-a-database-uri-with-sensitive-material" }),
      { status: 200 },
    ));
    const neon = new NeonProvisioner(
      { apiKey: "test-key", orgId: "test-org" },
      fetchImpl as typeof fetch,
    );

    await expect(neon.getConnectionUri("project_test")).rejects.toThrow(
      "Neon returned an invalid connection URI",
    );
  });
});
