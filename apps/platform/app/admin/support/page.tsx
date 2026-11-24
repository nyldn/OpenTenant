import { AdminAccessDenied } from "../_components/admin-access-denied";
import { AdminMutationForm } from "../_components/admin-mutation-form";
import { Input, Textarea } from "@opentenant/design-system";
import Link from "next/link";
import { redirect } from "next/navigation";
import { installationOwnerContext } from "../../../lib/installation-owner";
import { currentTenant } from "../../../lib/tenant";

export const dynamic = "force-dynamic";

/** Tenant-host entry form for an explicit, reason-bound support session. */
export default async function ManagedSupportEntryPage() {
  const owner = await installationOwnerContext("owner.support.enter");
  if (!owner.ok) {
    if (owner.reason === "anonymous") redirect("/auth/login?return=/admin/support");
    return <AdminAccessDenied />;
  }
  const tenant = await currentTenant();
  if (!tenant) redirect("/admin");

  return (
    <main className="mx-auto min-h-svh w-full max-w-xl px-6 py-16 text-foreground">
      <p className="text-sm font-medium text-warning-text">Managed support</p>
      <h1 className="mt-2 font-display text-2xl font-bold [overflow-wrap:anywhere]">Enter {tenant.displayName}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your real operator identity and reason remain visible and audited. This session permits routine
        configuration only; customer data, credentials, identity, billing, exports, and deletion remain blocked.
      </p>

      <AdminMutationForm action="/api/admin/support-sessions" submitLabel="Start 30-minute session" className="mt-8 space-y-5">
        <label className="block text-sm font-medium">
          Reason
          <Textarea
            name="reason"
            required
            minLength={8}
            maxLength={500}
            rows={4}
            className="mt-2"
            placeholder="Describe the approved configuration work"
          />
        </label>
        <label className="block text-sm font-medium">
          Ticket or change reference <span className="text-muted-foreground">(optional)</span>
          <Input
            name="reference"
            maxLength={120}
            className="mt-2"
          />
        </label>
        <div className="flex items-center gap-3">
          <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">Cancel</Link>
        </div>
      </AdminMutationForm>
    </main>
  );
}
