import { describe, expect, it } from "vitest";
import type {
  SandboxCommandRequest,
  SandboxCreateRequest,
  SandboxFileWrite,
  SandboxPreviewRequest,
  SandboxWriteFilesRequest,
} from "./contracts";
import { SandboxError } from "./errors";
import {
  SANDBOX_HARD_LIMITS,
  normalizeWorkspacePath,
  validateCommandRequest,
  validateCreateRequest,
  validatePreviewRequest,
  validateWriteFilesRequest,
} from "./policy";

const encoder = new TextEncoder();

function createRequest(changes: Partial<SandboxCreateRequest> = {}): SandboxCreateRequest {
  return {
    tenantId: "tenant_test",
    workspaceId: "workspace_test",
    template: {
      id: "react-module",
      version: "1.0.0",
      digest: "sha256:0123456789abcdef",
    },
    limits: {
      cpuCores: 1,
      memoryMb: 512,
      durationMs: 30 * 60_000,
      commandTimeoutMs: 5 * 60_000,
      commandOutputBytes: 1_000_000,
      fileBytes: 1_000_000,
      fileCount: 100,
    },
    network: { mode: "deny_all", allowedHosts: [] },
    ...changes,
  };
}

function commandRequest(
  changes: Partial<SandboxCommandRequest> = {},
): SandboxCommandRequest {
  return {
    sandboxId: "sandbox_test" as SandboxCommandRequest["sandboxId"],
    executable: "pnpm",
    args: ["test"],
    cwd: "workspace/app",
    timeoutMs: 60_000,
    outputLimitBytes: 100_000,
    ...changes,
  };
}

function previewRequest(
  changes: Partial<SandboxPreviewRequest> = {},
): SandboxPreviewRequest {
  return {
    sandboxId: "sandbox_test" as SandboxPreviewRequest["sandboxId"],
    port: 3000,
    path: "/",
    expiresInMs: 15 * 60_000,
    ...changes,
  };
}

function file(path: string, contents = "content"): SandboxFileWrite {
  return { path, contents: encoder.encode(contents) };
}

function expectPolicyDenial(run: () => unknown, field: string): void {
  try {
    run();
    throw new Error("Expected policy denial");
  } catch (error) {
    expect(error).toBeInstanceOf(SandboxError);
    expect(error).toMatchObject({
      code: "policy_denied",
      details: { field },
    });
  }
}

describe("workspace paths", () => {
  it.each(["/etc/passwd", "../secret", "a/../../secret", "", ".", "a\0b", "a\\b"])(
    "rejects unsafe path %j",
    (path) => {
      expectPolicyDenial(() => normalizeWorkspacePath(path, "write_files"), "path");
    },
  );

  it.each([
    ["src/index.ts", "src/index.ts"],
    ["./src/./index.ts", "src/index.ts"],
    ["workspace/app/package.json", "workspace/app/package.json"],
  ])("normalizes %j", (path, expected) => {
    expect(normalizeWorkspacePath(path, "write_files")).toBe(expected);
  });
});

describe("create policy", () => {
  it("accepts deny-all defaults within hard limits", () => {
    expect(validateCreateRequest(createRequest())).toEqual(createRequest());
  });

  it.each([
    ["cpuCores", { cpuCores: SANDBOX_HARD_LIMITS.cpuCores + 0.1 }],
    ["memoryMb", { memoryMb: SANDBOX_HARD_LIMITS.memoryMb + 1 }],
    ["durationMs", { durationMs: SANDBOX_HARD_LIMITS.durationMs + 1 }],
    ["commandTimeoutMs", { commandTimeoutMs: SANDBOX_HARD_LIMITS.commandTimeoutMs + 1 }],
    ["commandOutputBytes", { commandOutputBytes: SANDBOX_HARD_LIMITS.commandOutputBytes + 1 }],
    ["fileBytes", { fileBytes: SANDBOX_HARD_LIMITS.fileBytes + 1 }],
    ["fileCount", { fileCount: SANDBOX_HARD_LIMITS.fileCount + 1 }],
  ] as const)("rejects an excessive %s", (field, change) => {
    expectPolicyDenial(
      () => validateCreateRequest(createRequest({ limits: { ...createRequest().limits, ...change } })),
      `limits.${field}`,
    );
  });

  it.each(["https://example.test", "user@example.test", "example.test/path", "example.test:443"])(
    "rejects malformed allowlisted host %j",
    (host) => {
      expectPolicyDenial(
        () =>
          validateCreateRequest(
            createRequest({ network: { mode: "allowlist", allowedHosts: [host] } }),
          ),
        "network.allowedHosts",
      );
    },
  );

  // OWNER-DEVELOPER-MCP-02 requires egress denial of link-local, loopback,
  // private ranges and provider metadata endpoints to be proven rather than
  // asserted. Every case below passed the previous DNS-label grammar check.
  it.each([
    // The one that matters. AWS IMDS, and the same address on Azure and GCE.
    "169.254.169.254",
    // Alternative spellings of that address and of loopback. inet_aton accepts
    // all of them, so a dotted-quad-only check is not a check.
    "0xa9.0xfe.0xa9.0xfe",
    "2852039166",
    "0x7f000001",
    "0177.0.0.1",
    "127.1",
    // Loopback and link-local by name and by number.
    "localhost",
    "127.0.0.1",
    "169.254.0.1",
    // RFC 1918 and carrier-grade NAT.
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    // Provider metadata by name, including the bare labels that resolve
    // through the resolver's search domains.
    "metadata.google.internal",
    "metadata",
    "instance-data",
    "kubernetes.default.svc.cluster.local",
    // Internal suffixes.
    "db.internal",
    "printer.local",
    "host.localdomain",
    "api.localhost",
  ])("refuses %j in an egress allowlist", (host) => {
    expectPolicyDenial(
      () =>
        validateCreateRequest(
          createRequest({ network: { mode: "allowlist", allowedHosts: [host] } }),
        ),
      "network.allowedHosts",
    );
  });

  it.each([
    "example.test",
    "api.example.test",
    "registry.npmjs.org",
    "sub-domain.example.co.uk",
    "1api.example.test",
  ])("still permits the legitimate host %j", (host) => {
    // A denial rule that denies everything is not a security control, it is an
    // outage. Names beginning with a digit must survive: the IP-literal rule
    // keys on every label being numeric, not on the first character.
    const result = validateCreateRequest(
      createRequest({ network: { mode: "allowlist", allowedHosts: [host] } }),
    );
    expect(result.network.allowedHosts).toEqual([host]);
  });

  it("requires an empty host list in deny-all mode", () => {
    expectPolicyDenial(
      () =>
        validateCreateRequest(
          createRequest({ network: { mode: "deny_all", allowedHosts: ["example.test"] } }),
        ),
      "network.allowedHosts",
    );
  });
});

describe("file-write policy", () => {
  const limits = createRequest().limits;

  it("normalizes accepted paths without mutating the request", () => {
    const request: SandboxWriteFilesRequest = {
      sandboxId: "sandbox_test" as SandboxWriteFilesRequest["sandboxId"],
      files: [file("./src/./index.ts")],
    };

    const result = validateWriteFilesRequest(request, limits);

    expect(result.files[0]?.path).toBe("src/index.ts");
    expect(request.files[0]?.path).toBe("./src/./index.ts");
  });

  it("rejects duplicate normalized paths", () => {
    const request: SandboxWriteFilesRequest = {
      sandboxId: "sandbox_test" as SandboxWriteFilesRequest["sandboxId"],
      files: [file("src/index.ts"), file("./src/index.ts")],
    };

    expectPolicyDenial(() => validateWriteFilesRequest(request, limits), "files.path");
  });

  it("rejects file count and aggregate byte limits", () => {
    const sandboxId = "sandbox_test" as SandboxWriteFilesRequest["sandboxId"];
    expectPolicyDenial(
      () => validateWriteFilesRequest({ sandboxId, files: [file("a"), file("b")] }, { ...limits, fileCount: 1 }),
      "files",
    );
    expectPolicyDenial(
      () => validateWriteFilesRequest({ sandboxId, files: [file("a", "1234")] }, { ...limits, fileBytes: 3 }),
      "files.contents",
    );
  });
});

describe("command policy", () => {
  const limits = createRequest().limits;

  it.each(["", "https://example.test/run", "pnpm\ntest", "pnpm\0test"])(
    "rejects unsafe executable %j",
    (executable) => {
      expectPolicyDenial(
        () => validateCommandRequest(commandRequest({ executable }), limits),
        "executable",
      );
    },
  );

  it("rejects excessive timeout and output limits", () => {
    expectPolicyDenial(
      () => validateCommandRequest(commandRequest({ timeoutMs: limits.commandTimeoutMs + 1 }), limits),
      "timeoutMs",
    );
    expectPolicyDenial(
      () =>
        validateCommandRequest(
          commandRequest({ outputLimitBytes: limits.commandOutputBytes + 1 }),
          limits,
        ),
      "outputLimitBytes",
    );
  });

  it("accepts structured executable and arguments at the policy boundary", () => {
    expect(validateCommandRequest(commandRequest(), limits)).toEqual(commandRequest());
  });
});

describe("preview policy", () => {
  it.each([0, 1023, 65_536])("rejects port %d", (port) => {
    expectPolicyDenial(() => validatePreviewRequest(previewRequest({ port })), "port");
  });

  it.each(["", "relative", "//other-host/path", "/path\0secret"])(
    "rejects preview path %j",
    (path) => {
      expectPolicyDenial(() => validatePreviewRequest(previewRequest({ path })), "path");
    },
  );

  it("rejects previews beyond the hard expiry", () => {
    expectPolicyDenial(
      () =>
        validatePreviewRequest(
          previewRequest({ expiresInMs: SANDBOX_HARD_LIMITS.previewExpiresInMs + 1 }),
        ),
      "expiresInMs",
    );
  });
});
