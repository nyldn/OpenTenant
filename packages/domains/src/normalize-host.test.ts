import { describe, expect, it } from "vitest";
import { normalizeHost } from "./normalize-host";

describe("normalizeHost", () => {
  it("lowercases and strips port", () => {
    expect(normalizeHost("Tenant.Example.Test:443")).toBe("tenant.example.test");
  });

  it("accepts a valid custom domain unchanged", () => {
    expect(normalizeHost("assessment.example.test")).toBe("assessment.example.test");
  });

  it("drops a single trailing dot", () => {
    expect(normalizeHost("tenant.example.test.")).toBe("tenant.example.test");
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["null-ish", null],
    ["scheme smuggling", "https://evil.test"],
    ["path smuggling", "tenant.example.test/admin"],
    ["userinfo smuggling", "user@tenant.example.test"],
    ["backslash", "tenant.example.test\\x"],
    ["ipv6 literal", "[::1]:3000"],
    ["ipv4 literal", "127.0.0.1"],
    ["non-numeric port", "tenant.example.test:port"],
    ["port above 65535", "tenant.example.test:99999"],
    ["double port", "tenant.example.test:80:80"],
    ["bare name", "localhost"],
    ["empty label", "tenant..example.test"],
    ["leading hyphen label", "-tenant.example.test"],
    ["trailing hyphen label", "tenant-.example.test"],
    ["underscore", "ten_ant.example.test"],
    ["overlong", `${"a".repeat(64)}.example.test`],
    ["over 253 chars", `${"a63.".repeat(64)}ai`],
  ])("rejects %s", (_name, input) => {
    expect(normalizeHost(input)).toBeNull();
  });

  it("rejects double trailing dots", () => {
    expect(normalizeHost("tenant.example.test..")).toBeNull();
  });
});
