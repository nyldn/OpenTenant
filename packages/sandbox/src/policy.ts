import type {
  SandboxCommandRequest,
  SandboxCreateRequest,
  SandboxLimits,
  SandboxOperation,
  SandboxPreviewRequest,
  SandboxWriteFilesRequest,
} from "./contracts";
import { SandboxError } from "./errors";

export const SANDBOX_HARD_LIMITS = Object.freeze({
  cpuCores: 8,
  memoryMb: 16_384,
  durationMs: 4 * 60 * 60_000,
  commandTimeoutMs: 15 * 60_000,
  commandOutputBytes: 10 * 1024 * 1024,
  fileBytes: 10 * 1024 * 1024,
  fileCount: 1_000,
  previewExpiresInMs: 60 * 60_000,
});

function deny(operation: SandboxOperation, field: string): never {
  throw new SandboxError({
    code: "policy_denied",
    operation,
    message: "Sandbox request violates workspace policy",
    details: { field },
  });
}

function isNonEmptyIdentifier(value: string): boolean {
  return value.trim().length > 0 && !/[\0\r\n]/u.test(value);
}

function validatePositiveLimit(
  operation: SandboxOperation,
  field: string,
  value: number,
  maximum: number,
): void {
  if (!Number.isFinite(value) || value <= 0 || value > maximum) {
    deny(operation, field);
  }
}

export function normalizeWorkspacePath(path: string, operation: SandboxOperation): string {
  if (
    path.length === 0 ||
    path === "." ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /[\0\r\n]/u.test(path)
  ) {
    deny(operation, "path");
  }

  const segments = path.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) {
    deny(operation, "path");
  }

  return segments.join("/");
}

/**
 * Names that must never appear in an egress allowlist, whatever else is true.
 *
 * `instance-data` and a bare `metadata` resolve to the metadata service on EC2
 * and GCE respectively through the resolver's search domains, which is why the
 * single-label rule below matters as much as this list.
 */
const FORBIDDEN_HOST_SUFFIXES = Object.freeze([
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
]);

/**
 * Rejects an IPv4 address written in any notation `inet_aton` accepts.
 *
 * Dotted quad is the obvious one. It also accepts a bare 32-bit integer
 * (`2852039166`), hex (`0x7f000001`), octal (`0177.0.0.1`), and short forms
 * (`127.1`), and browsers and HTTP clients follow suit. A check that only knows
 * about dotted quad hands an attacker four other spellings of the same address.
 */
function looksLikeIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length > 4) return false;
  return parts.every((part) => /^(0x[0-9a-f]+|0[0-7]*|[0-9]+)$/iu.test(part));
}

/**
 * Validates a host for an egress allowlist.
 *
 * This used to be a DNS-label grammar check and nothing more, so it accepted
 * every address the sandbox most needed to refuse. `169.254.169.254` splits
 * into four all-digit labels, each of which matches `[a-z0-9]`, so the cloud
 * metadata endpoint passed. So did `localhost`, `10.0.0.1` and
 * `metadata.google.internal`. An allowlist that admits the metadata service is
 * a credential-exfiltration path with extra steps.
 *
 * The rules, in the order they matter:
 *
 * 1. **No IP literals.** An allowlist names services, not addresses. Refusing
 *    the whole category avoids maintaining a range table and closes the
 *    alternative notations in one move.
 * 2. **No single-label names.** A bare `metadata` or `instance-data` resolves
 *    through the resolver's search domains to internal infrastructure.
 *    Requiring a dot also removes `localhost`.
 * 3. **No loopback, link-local or internal suffixes.**
 * 4. Then the original DNS-label grammar.
 *
 * **This is not the whole control, and must not be described as one.** It
 * constrains what an allowlist may *say*. It cannot stop a permitted name from
 * resolving to a forbidden address, whether by an attacker's own DNS record or
 * by rebinding between check and connect. Denying the resolved address belongs
 * at connect time in the adapter, against the IP actually dialled. Until that
 * exists, treat this as necessary and insufficient.
 */
function validateHost(host: string): boolean {
  if (host.length === 0 || host.length > 253 || host.includes("..")) {
    return false;
  }

  const lowered = host.toLowerCase();
  if (looksLikeIpv4(lowered)) {
    return false;
  }
  if (!lowered.includes(".")) {
    return false;
  }
  if (FORBIDDEN_HOST_SUFFIXES.some((suffix) => lowered.endsWith(suffix))) {
    return false;
  }

  return lowered.split(".").every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label),
  );
}

function validateLimits(limits: SandboxLimits): void {
  validatePositiveLimit("create", "limits.cpuCores", limits.cpuCores, SANDBOX_HARD_LIMITS.cpuCores);
  validatePositiveLimit("create", "limits.memoryMb", limits.memoryMb, SANDBOX_HARD_LIMITS.memoryMb);
  validatePositiveLimit("create", "limits.durationMs", limits.durationMs, SANDBOX_HARD_LIMITS.durationMs);
  validatePositiveLimit(
    "create",
    "limits.commandTimeoutMs",
    limits.commandTimeoutMs,
    SANDBOX_HARD_LIMITS.commandTimeoutMs,
  );
  validatePositiveLimit(
    "create",
    "limits.commandOutputBytes",
    limits.commandOutputBytes,
    SANDBOX_HARD_LIMITS.commandOutputBytes,
  );
  validatePositiveLimit("create", "limits.fileBytes", limits.fileBytes, SANDBOX_HARD_LIMITS.fileBytes);
  validatePositiveLimit("create", "limits.fileCount", limits.fileCount, SANDBOX_HARD_LIMITS.fileCount);

  if (limits.commandTimeoutMs > limits.durationMs) {
    deny("create", "limits.commandTimeoutMs");
  }
}

export function validateCreateRequest(request: SandboxCreateRequest): SandboxCreateRequest {
  if (!isNonEmptyIdentifier(request.tenantId)) {
    deny("create", "tenantId");
  }
  if (!isNonEmptyIdentifier(request.workspaceId)) {
    deny("create", "workspaceId");
  }
  if (!isNonEmptyIdentifier(request.template.id)) {
    deny("create", "template.id");
  }
  if (!isNonEmptyIdentifier(request.template.version)) {
    deny("create", "template.version");
  }
  if (!/^sha256:[a-f0-9]{16,}$/u.test(request.template.digest)) {
    deny("create", "template.digest");
  }

  validateLimits(request.limits);

  if (request.network.mode === "deny_all" && request.network.allowedHosts.length > 0) {
    deny("create", "network.allowedHosts");
  }
  if (request.network.mode === "allowlist" && request.network.allowedHosts.length === 0) {
    deny("create", "network.allowedHosts");
  }
  if (
    request.network.allowedHosts.some((host) => !validateHost(host)) ||
    new Set(request.network.allowedHosts.map((host) => host.toLowerCase())).size !==
      request.network.allowedHosts.length
  ) {
    deny("create", "network.allowedHosts");
  }

  return {
    ...request,
    limits: { ...request.limits },
    network: {
      mode: request.network.mode,
      allowedHosts: request.network.allowedHosts.map((host) => host.toLowerCase()),
    },
    template: { ...request.template },
  };
}

export function validateWriteFilesRequest(
  request: SandboxWriteFilesRequest,
  limits: SandboxLimits,
): SandboxWriteFilesRequest {
  if (request.files.length === 0 || request.files.length > limits.fileCount) {
    deny("write_files", "files");
  }

  let totalBytes = 0;
  const paths = new Set<string>();
  const files = request.files.map((entry) => {
    const path = normalizeWorkspacePath(entry.path, "write_files");
    if (paths.has(path)) {
      deny("write_files", "files.path");
    }
    paths.add(path);
    totalBytes += entry.contents.byteLength;
    if (totalBytes > limits.fileBytes) {
      deny("write_files", "files.contents");
    }
    return { path, contents: entry.contents };
  });

  return { sandboxId: request.sandboxId, files };
}

export function validateCommandRequest(
  request: SandboxCommandRequest,
  limits: SandboxLimits,
): SandboxCommandRequest {
  if (
    request.executable.trim().length === 0 ||
    request.executable.includes("://") ||
    /[\0\r\n]/u.test(request.executable)
  ) {
    deny("run_command", "executable");
  }
  if (request.args.some((argument) => /[\0\r\n]/u.test(argument))) {
    deny("run_command", "args");
  }
  if (
    !Number.isFinite(request.timeoutMs) ||
    request.timeoutMs <= 0 ||
    request.timeoutMs > limits.commandTimeoutMs
  ) {
    deny("run_command", "timeoutMs");
  }
  if (
    !Number.isFinite(request.outputLimitBytes) ||
    request.outputLimitBytes <= 0 ||
    request.outputLimitBytes > limits.commandOutputBytes
  ) {
    deny("run_command", "outputLimitBytes");
  }

  return {
    ...request,
    args: [...request.args],
    cwd: normalizeWorkspacePath(request.cwd, "run_command"),
  };
}

export function validatePreviewRequest(request: SandboxPreviewRequest): SandboxPreviewRequest {
  if (!Number.isInteger(request.port) || request.port < 1024 || request.port > 65_535) {
    deny("start_preview", "port");
  }
  if (
    !request.path.startsWith("/") ||
    request.path.startsWith("//") ||
    /[\0\r\n]/u.test(request.path)
  ) {
    deny("start_preview", "path");
  }
  validatePositiveLimit(
    "start_preview",
    "expiresInMs",
    request.expiresInMs,
    SANDBOX_HARD_LIMITS.previewExpiresInMs,
  );
  return { ...request };
}
