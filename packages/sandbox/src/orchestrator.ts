import type {
  SandboxAdapter,
  SandboxArtifact,
  SandboxCommandResult,
  SandboxCreateRequest,
  SandboxId,
  SandboxPreview,
} from "./contracts";
import { SandboxError } from "./errors";
import {
  digestTemplateFiles,
  SYNTHETIC_MODULE_TEMPLATE,
  type ApprovedModuleTemplate,
} from "./template";

export interface ModuleProofInput {
  readonly adapter: SandboxAdapter;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly template?: ApprovedModuleTemplate;
  readonly limits: SandboxCreateRequest["limits"];
  readonly network: SandboxCreateRequest["network"];
}

export interface ModuleProofCommandEvidence {
  readonly name: "install" | "build" | "test";
  readonly executable: string;
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly outputTruncated: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export interface ModuleProofEvidence {
  readonly schemaVersion: 1;
  readonly provider: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly sandboxId: SandboxId;
  readonly template: SandboxCreateRequest["template"];
  readonly commands: readonly ModuleProofCommandEvidence[];
  readonly preview: {
    readonly url: string;
    readonly authenticated: true;
    readonly expiresAt: string;
  };
  readonly artifact: { readonly path: string; readonly digest: string; readonly byteLength: number };
  readonly terminated: true;
}

const REQUIRED_CAPABILITIES = [
  "structuredCommands",
  "previews",
  "artifacts",
  "resourceLimits",
  "networkPolicy",
  "authenticatedPreviews",
  "deterministicTeardown",
] as const;

const COMMANDS = Object.freeze([
  { name: "install", executable: "pnpm", args: ["install", "--offline", "--frozen-lockfile"] },
  { name: "build", executable: "pnpm", args: ["run", "build"] },
  { name: "test", executable: "pnpm", args: ["test", "--", "--run"] },
] as const);

function assertCapabilities(adapter: SandboxAdapter): void {
  const missing = REQUIRED_CAPABILITIES.filter((capability) => !adapter.capabilities[capability]);
  if (missing.length > 0) {
    throw new SandboxError({
      code: "unsupported",
      operation: "create",
      message: "Sandbox provider lacks capabilities required for module validation",
      details: { missing: missing.join(",") },
    });
  }
}

function commandEvidence(
  command: typeof COMMANDS[number],
  result: SandboxCommandResult,
): ModuleProofCommandEvidence {
  return {
    name: command.name,
    executable: command.executable,
    args: [...command.args],
    exitCode: result.exitCode,
    outputTruncated: result.outputTruncated,
    startedAt: result.startedAt.toISOString(),
    finishedAt: result.finishedAt.toISOString(),
  };
}

function requireSuccessfulCommand(name: string, result: SandboxCommandResult): void {
  if (result.exitCode !== 0) {
    throw new SandboxError({
      code: "provider_failure",
      operation: "run_command",
      message: "Sandbox module validation command failed",
      details: { step: name, exitCode: result.exitCode },
    });
  }
}

function previewEvidence(preview: SandboxPreview): ModuleProofEvidence["preview"] {
  if (!preview.authenticated) {
    throw new SandboxError({
      code: "policy_denied",
      operation: "start_preview",
      message: "Sandbox preview is not authenticated",
    });
  }
  return {
    url: preview.url.toString(),
    authenticated: true,
    expiresAt: preview.expiresAt.toISOString(),
  };
}

function artifactEvidence(artifact: SandboxArtifact): ModuleProofEvidence["artifact"] {
  return { path: artifact.path, digest: artifact.digest, byteLength: artifact.contents.byteLength };
}

export async function proveSyntheticModuleLifecycle(input: ModuleProofInput): Promise<ModuleProofEvidence> {
  assertCapabilities(input.adapter);
  const template = input.template ?? SYNTHETIC_MODULE_TEMPLATE;
  const templateRef = { ...template.ref };
  const workingDirectory = template.workingDirectory;
  const validationArtifactPath = template.validationArtifactPath;
  const previewPort = template.previewPort;
  const templateFiles = template.files().map((file) => ({
    path: file.path,
    contents: Uint8Array.from(file.contents),
  }));
  if (digestTemplateFiles(templateFiles) !== templateRef.digest) {
    throw new SandboxError({
      code: "policy_denied",
      operation: "create",
      message: "Sandbox template integrity check failed",
    });
  }
  let sandboxId: SandboxId | undefined;
  let completed: Omit<ModuleProofEvidence, "terminated"> | undefined;

  try {
    const workspace = await input.adapter.create({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      template: { ...templateRef },
      limits: input.limits,
      network: input.network,
    });
    sandboxId = workspace.id;
    await input.adapter.writeFiles({ sandboxId, files: templateFiles });

    const commands: ModuleProofCommandEvidence[] = [];
    for (const command of COMMANDS) {
      const result = await input.adapter.runCommand({
        sandboxId,
        executable: command.executable,
        args: command.args,
        cwd: workingDirectory,
        timeoutMs: input.limits.commandTimeoutMs,
        outputLimitBytes: input.limits.commandOutputBytes,
      });
      requireSuccessfulCommand(command.name, result);
      commands.push(commandEvidence(command, result));
    }

    const preview = await input.adapter.startPreview({
      sandboxId,
      port: previewPort,
      path: "/",
      expiresInMs: Math.min(15 * 60_000, input.limits.durationMs),
    });
    const artifact = await input.adapter.collectArtifact({
      sandboxId,
      path: validationArtifactPath,
      maxBytes: input.limits.fileBytes,
    });
    completed = {
      schemaVersion: 1,
      provider: input.adapter.provider,
      tenantId: workspace.tenantId,
      workspaceId: workspace.workspaceId,
      sandboxId,
      template: { ...templateRef },
      commands,
      preview: previewEvidence(preview),
      artifact: artifactEvidence(artifact),
    };
  } finally {
    if (sandboxId !== undefined) await input.adapter.terminate(sandboxId);
  }

  if (completed === undefined) {
    throw new SandboxError({
      code: "provider_failure",
      operation: "terminate",
      message: "Sandbox module validation did not produce evidence",
    });
  }
  return { ...completed, terminated: true };
}
