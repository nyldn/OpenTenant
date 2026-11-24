import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { tenantAdminContext } from "../../lib/tenant-admin";
import { ApplicationShell } from "../_components/application-shell";

export const dynamic = "force-dynamic";

/** Settings authorization remains independent of shell navigation. */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const gate = await tenantAdminContext("branding.configure");
  if (!gate.ok) redirect(gate.reason === "anonymous" ? "/auth/login?return=/settings" : "/");
  return <ApplicationShell section="settings" session={gate.context.session}>
    <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 sm:px-6">{children}</main>
  </ApplicationShell>;
}
