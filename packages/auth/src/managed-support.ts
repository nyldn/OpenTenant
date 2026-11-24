import type { TenantId, UserId } from "./identity";

export const SUPPORT_ACTIONS = [
  "branding.configure",
  "module.settings.configure",
  "domain.metadata.configure",
  "integration.metadata.configure",
  "customer_data.read",
  "customer_data.export",
  "credential.rotate",
  "module.access.configure",
  "data.delete",
  "billing.manage",
  "identity.manage",
  "module.capability.grant",
  "domain.activate",
  "integration.authorize",
] as const;

export type SupportAction = (typeof SUPPORT_ACTIONS)[number];
export type SupportActionClass = "routine_configuration" | "sensitive";

export interface ManagedSupportSession {
  readonly sessionId: string;
  readonly installationId: string;
  readonly tenantId: TenantId | string;
  readonly operatorUserId: UserId | string;
  readonly reason: string;
  readonly reference: string | null;
  readonly allowedActionClasses: ReadonlyArray<SupportActionClass>;
  readonly createdAt: Date;
  readonly lastActivityAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

const routine = new Set<SupportAction>([
  "branding.configure",
  "module.settings.configure",
  "domain.metadata.configure",
  "integration.metadata.configure",
]);
const known = new Set<string>(SUPPORT_ACTIONS);

export function classifySupportAction(action: SupportAction): SupportActionClass {
  return routine.has(action) ? "routine_configuration" : "sensitive";
}

export type SupportAuthorizationDecision =
  | { allowed: true; actionClass: "routine_configuration" }
  | { allowed: false; reason: "inactive_support_session" | "unknown_support_action" | "separate_sensitive_authority_required" | "action_class_not_granted" };

export function authorizeSupportAction(
  session: ManagedSupportSession,
  action: SupportAction,
  now = new Date(),
): SupportAuthorizationDecision {
  if (!known.has(action)) return { allowed: false, reason: "unknown_support_action" };
  if (session.revokedAt !== null || session.expiresAt.getTime() <= now.getTime()) {
    return { allowed: false, reason: "inactive_support_session" };
  }
  const actionClass = classifySupportAction(action);
  if (actionClass === "sensitive") {
    return { allowed: false, reason: "separate_sensitive_authority_required" };
  }
  if (!session.allowedActionClasses.includes(actionClass)) {
    return { allowed: false, reason: "action_class_not_granted" };
  }
  return { allowed: true, actionClass };
}
