import type { DeliverySafeErrorClass } from "./support-depth-types";

export const EMAIL_MAX_ATTEMPTS = 5;
/** SMTP's configured connection/greeting/socket timeouts fit inside this lease. */
export const EMAIL_LEASE_SECONDS = 300;
export type EmailDeliveryStatus = "pending" | "retry" | "sending" | "delivered" | "failed";

/** Driver and provider text is never persisted, audited, or rendered. */
export function safeDeliveryError(value: unknown): DeliverySafeErrorClass {
  return value === "permanent" || value === "destination_unavailable" ? value : "transient";
}

export function emailFailure(attempt: number, error: unknown) {
  const safeError = safeDeliveryError(error);
  const status = safeError !== "transient" || attempt >= EMAIL_MAX_ATTEMPTS ? "failed" : "retry";
  return { status, safeError, delaySeconds: Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1)) } as const;
}
