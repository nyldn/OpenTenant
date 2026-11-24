import type { SandboxOperation } from "./contracts";

export type SandboxErrorCode =
  | "invalid_request"
  | "policy_denied"
  | "not_found"
  | "conflict"
  | "unsupported"
  | "timeout"
  | "rate_limited"
  | "provider_unavailable"
  | "provider_failure";

export type SandboxErrorDetails = Readonly<
  Record<string, string | number | boolean>
>;

export interface SandboxErrorInput {
  readonly code: SandboxErrorCode;
  readonly operation: SandboxOperation;
  readonly message: string;
  readonly details?: SandboxErrorDetails;
  readonly cause?: unknown;
}

const RETRYABLE_CODES: ReadonlySet<SandboxErrorCode> = new Set([
  "timeout",
  "rate_limited",
  "provider_unavailable",
]);

export class SandboxError extends Error {
  readonly code: SandboxErrorCode;
  readonly operation: SandboxOperation;
  readonly retryable: boolean;
  readonly details?: SandboxErrorDetails;

  constructor(input: SandboxErrorInput) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "SandboxError";
    this.code = input.code;
    this.operation = input.operation;
    this.retryable = RETRYABLE_CODES.has(input.code);
    if (input.details !== undefined) {
      this.details = Object.freeze({ ...input.details });
    }
  }
}
