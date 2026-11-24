import { describe, expect, it, vi } from "vitest";
import { pooledHost, createAppRole, ensureAppRole } from "./app-role";

const query = vi.hoisted(() => vi.fn(async (_sql: string) => ({ rows: [{ exists: false }] })));
vi.mock("pg", () => ({ Client: class {
  connect = vi.fn(); query = query; end = vi.fn();
} }));

describe("application role setup", () => {
  it.each(["127.0.0.1", "ep-synthetic.us-east-1.aws.neon.tech"])("preserves local hosts and pools Neon hosts: %s", async (host) => {
    const result = await createAppRole(`postgresql://owner:synthetic@${host}:55439/tenant?sslmode=verify-full`);
    const uri = new URL(result.appConnectionUri);
    expect(uri.hostname).toBe(host.endsWith(".neon.tech") ? "ep-synthetic-pooler.us-east-1.aws.neon.tech" : host);
    expect(uri.username).toBe("tenant_app");
    expect(uri.port).toBe("55439");
    expect(uri.searchParams.get("sslmode")).toBe("verify-full");
  });
  it("creates a non-login role before schema grants without rotating existing credentials", async () => {
    query.mockClear();
    await ensureAppRole("postgresql://owner:synthetic@localhost/tenant");
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain("create role tenant_app nologin nobypassrls");
    expect(query.mock.calls[0]?.[0]).not.toContain("password");
  });
});

describe("pooledHost", () => {
  it("inserts -pooler after the endpoint segment", () => {
    expect(pooledHost("ep-cool-name-123.us-east-1.aws.neon.tech")).toBe(
      "ep-cool-name-123-pooler.us-east-1.aws.neon.tech",
    );
  });

  it("passes an already-pooled host through unchanged", () => {
    expect(pooledHost("ep-cool-name-123-pooler.us-east-1.aws.neon.tech")).toBe(
      "ep-cool-name-123-pooler.us-east-1.aws.neon.tech",
    );
  });
});
