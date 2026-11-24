import {
  authorizeSupportAction,
  authorizeInstallationAction,
  type IdentitySession,
  type ManagedSupportSession,
  type SupportAction,
} from "@opentenant/auth";
import type { ResolvedTenant } from "@opentenant/database";
import { currentSession } from "./session";
import { currentTenant } from "./tenant";
import { supportSessionToken } from "./support-session-cookie";
import { supportSessionStore } from "./support-session-store";

export interface ManagedSupportContext {
  sessionId: string;
  tenant: ResolvedTenant;
  operator: IdentitySession;
  reason: string;
  reference: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface ManagedSupportSessionContext {
  sessionId: string;
  tenantId: string;
  operator: IdentitySession;
  reason: string;
  reference: string | null;
  createdAt: Date;
  expiresAt: Date;
}

type ActiveSessionResult =
  | { ok: true; session: ManagedSupportSession }
  | { ok: false; reason: "no_support_session" | "support_context_mismatch" };

async function activeSessionFor(
  operator: IdentitySession,
  tenantId: string,
): Promise<ActiveSessionResult> {
  const token = await supportSessionToken();
  if (!token) return { ok: false, reason: "no_support_session" };
  const supportSession = await supportSessionStore().findActive(token);
  if (!supportSession) return { ok: false, reason: "no_support_session" };
  if (supportSession.tenantId !== tenantId || supportSession.operatorUserId !== operator.userId) {
    return { ok: false, reason: "support_context_mismatch" };
  }
  return { ok: true, session: supportSession };
}

export async function managedSupportContext(action: SupportAction): Promise<
  | { ok: true; context: ManagedSupportContext }
  | { ok: false; reason: "no_tenant" | "anonymous" | "no_support_session" | "support_context_mismatch" | "missing_installation_authority" | "support_action_denied" }
> {
  const tenant = await currentTenant();
  if (!tenant) return { ok: false, reason: "no_tenant" };
  const operator = await currentSession();
  if (!operator) return { ok: false, reason: "anonymous" };
  const authority = authorizeInstallationAction(operator, "owner.support.enter");
  if (!authority.allowed) return { ok: false, reason: "missing_installation_authority" };
  const active = await activeSessionFor(operator, tenant.tenantId);
  if (!active.ok) return active;
  const supportSession = active.session;
  const decision = authorizeSupportAction(supportSession, action);
  if (!decision.allowed) return { ok: false, reason: "support_action_denied" };
  return {
    ok: true,
    context: {
      sessionId: supportSession.sessionId,
      tenant,
      operator,
      reason: supportSession.reason,
      reference: supportSession.reference,
      createdAt: supportSession.createdAt,
      expiresAt: supportSession.expiresAt,
    },
  };
}

/**
 * Resolves only the short-lived, exact-tenant managed-support session.
 *
 * This is not action authority. Sensitive handlers must independently require
 * their operation-specific installation permission before calling it. Keeping
 * that second check at the handler prevents a routine support session from
 * becoming an ambient customer-data grant.
 */
export async function managedSupportSessionForTenant(tenantId: string): Promise<
  | { ok: true; context: ManagedSupportSessionContext }
  | {
      ok: false;
      reason:
        | "anonymous"
        | "missing_installation_authority"
        | "no_support_session"
        | "support_context_mismatch";
    }
> {
  const operator = await currentSession();
  if (!operator) return { ok: false, reason: "anonymous" };
  const authority = authorizeInstallationAction(operator, "owner.support.enter");
  if (!authority.allowed) return { ok: false, reason: "missing_installation_authority" };
  const active = await activeSessionFor(operator, tenantId);
  if (!active.ok) return active;
  return {
    ok: true,
    context: {
      sessionId: active.session.sessionId,
      tenantId: String(active.session.tenantId),
      operator,
      reason: active.session.reason,
      reference: active.session.reference,
      createdAt: active.session.createdAt,
      expiresAt: active.session.expiresAt,
    },
  };
}
