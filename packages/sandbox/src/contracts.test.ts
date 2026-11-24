import { describe, expect, expectTypeOf, it } from "vitest";
import {
  SandboxError,
  sandboxCapabilities,
  type SandboxAdapter,
  type SandboxCommandRequest,
  type SandboxStatus,
} from "./index";

describe("sandbox lifecycle contract", () => {
  it("keeps lifecycle states stable", () => {
    const states: SandboxStatus[] = [
      "creating",
      "ready",
      "stopped",
      "failed",
      "terminated",
    ];

    expect(states).toEqual([
      "creating",
      "ready",
      "stopped",
      "failed",
      "terminated",
    ]);
  });

  it("declares provider capabilities explicitly", () => {
    expect(
      sandboxCapabilities({
        structuredCommands: true,
        previews: true,
        checkpoints: "fork",
        processLogs: false,
        artifacts: true,
        resourceLimits: true,
        networkPolicy: true,
        authenticatedPreviews: true,
        deterministicTeardown: true,
      }),
    ).toEqual({
      structuredCommands: true,
      previews: true,
      checkpoints: "fork",
      processLogs: false,
      artifacts: true,
      resourceLimits: true,
      networkPolicy: true,
      authenticatedPreviews: true,
      deterministicTeardown: true,
    });
  });

  it("does not permit environment or credential fields in command requests", () => {
    type HasEnvironment = "environment" extends keyof SandboxCommandRequest ? true : false;
    type HasCredentials = "credentials" extends keyof SandboxCommandRequest ? true : false;

    expectTypeOf<HasEnvironment>().toEqualTypeOf<false>();
    expectTypeOf<HasCredentials>().toEqualTypeOf<false>();
  });

  it("exposes the complete lifecycle on every adapter", () => {
    expectTypeOf<SandboxAdapter>().toHaveProperty("create");
    expectTypeOf<SandboxAdapter>().toHaveProperty("writeFiles");
    expectTypeOf<SandboxAdapter>().toHaveProperty("runCommand");
    expectTypeOf<SandboxAdapter>().toHaveProperty("startPreview");
    expectTypeOf<SandboxAdapter>().toHaveProperty("checkpoint");
    expectTypeOf<SandboxAdapter>().toHaveProperty("restore");
    expectTypeOf<SandboxAdapter>().toHaveProperty("readLogs");
    expectTypeOf<SandboxAdapter>().toHaveProperty("collectArtifact");
    expectTypeOf<SandboxAdapter>().toHaveProperty("terminate");
  });
});

describe("SandboxError", () => {
  it("classifies retryable provider failures without exposing provider bodies", () => {
    const error = new SandboxError({
      code: "provider_unavailable",
      operation: "create",
      message: "Sandbox provider is temporarily unavailable",
    });

    expect(error.retryable).toBe(true);
    expect(error.code).toBe("provider_unavailable");
    expect(error.operation).toBe("create");
    expect(error.message).not.toContain("upstreamBody");
  });

  it("classifies policy failures as terminal", () => {
    const error = new SandboxError({
      code: "policy_denied",
      operation: "run_command",
      message: "Command request violates sandbox policy",
      details: { field: "timeoutMs" },
    });

    expect(error.retryable).toBe(false);
    expect(error.details).toEqual({ field: "timeoutMs" });
  });
});
