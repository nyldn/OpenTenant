import { FormStatus } from "@opentenant/design-system";
import { AdminAccessDenied } from "../../_components/admin-access-denied";
import { TenantActionForm } from "../tenant-action-form";
import { redirect } from "next/navigation";
import { authorizeInstallationAction } from "@opentenant/auth";
import { currentSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  owner: "Enter the initial owner email.",
  region: "Choose a supported data region.",
  name: "Enter a display name between 1 and 60 characters.",
  slug: "Use 2 to 40 lowercase letters, digits, or hyphens for the slug.",
  slug_taken: "That slug is already in use. Choose another.",
};

export default async function NewTenantPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await currentSession();
  if (!session) redirect("/auth/login?return=/admin/tenants/new");
  if (!authorizeInstallationAction(session, "owner.tenant.create").allowed) return <AdminAccessDenied />;

  const { error } = await searchParams;
  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <h1 className="font-display text-2xl font-bold">Create tenant</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Create the tenant record and begin provisioning its platform resources.
      </p>

      <section className="mt-6 max-w-xl rounded-lg border border-border bg-card p-5 text-card-foreground">
        <TenantActionForm action="/api/admin/tenants" className="space-y-4">
          <label className="block text-sm">
            Owner email
            <input name="ownerEmail" type="email" required maxLength={254} className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Display name
            </span>
            <input
              name="displayName"
              type="text"
              required
              minLength={1}
              maxLength={60}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Slug
            </span>
            <input
              name="slug"
              type="text"
              required
              minLength={2}
              maxLength={40}
              pattern="[a-z0-9-]{2,40}"
              title="lowercase, digits, hyphens"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs text-muted-foreground">lowercase, digits, hyphens</span>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Data region
            </span>
            <select
              name="dataRegion"
              defaultValue="us"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            >
              <option value="us">US</option>
              <option value="eu">EU</option>
            </select>
          </label>

          {errorMessage ? <FormStatus status="error">{errorMessage}</FormStatus> : null}

          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Create tenant
          </button>
        </TenantActionForm>
      </section>
    </main>
  );
}
