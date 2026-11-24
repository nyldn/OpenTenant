import {
  authorizeInstallationAction,
  type InstallationAuthority,
  type InstallationPermission,
} from "@opentenant/auth";
import { currentSession } from "./session";

export interface InstallationOwnerContext {
  authority: InstallationAuthority;
}

/** Authenticates and authorizes an installation-level operation. */
export async function installationOwnerContext(
  permission: InstallationPermission,
): Promise<
  | { ok: true; context: InstallationOwnerContext }
  | {
      ok: false;
      reason:
        | "anonymous"
        | "missing_installation_authority"
        | "unknown_installation_permission";
    }
> {
  const session = await currentSession();
  if (!session) return { ok: false, reason: "anonymous" };
  const decision = authorizeInstallationAction(session, permission);
  if (!decision.allowed) return { ok: false, reason: decision.reason };
  return { ok: true, context: { authority: decision.authority } };
}
