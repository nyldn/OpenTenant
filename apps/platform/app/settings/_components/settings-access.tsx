import { currentSession } from "../../../lib/session";
import { AccessDenied } from "@opentenant/design-system";

export function SettingsAccessDenied({ reason }: { reason?: string }) {
  return <div className="w-full min-w-0 max-w-3xl">
    <AccessDenied state={reason === "anonymous" ? "signed-out" : "forbidden"}
      description={reason === "anonymous" ? "Sign in to review tenant settings." : "Your account does not have permission to view these settings. Routine managed support cannot access members, identity setup or activity. You can return Home or exit support using the session banner."}
      action={reason === "anonymous" ? { label: "Sign in", href: "/auth/login?return=/settings" } : { label: "Home", href: "/" }} />
  </div>;
}

/** An expected-tenant mismatch is still an authenticated support restriction. */
export async function settingsDenialReason(reason: string): Promise<string> {
  return reason === "anonymous" && await currentSession() ? "forbidden" : reason;
}
