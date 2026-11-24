import { EmptyState } from "@opentenant/design-system";
import { SettingsAccessDenied, settingsDenialReason } from "../_components/settings-access";
import Link from "next/link";
import { tenantAdminContext } from "../../../lib/tenant-admin";
import { identityProviderFromEnv } from "../../../lib/identity-provider";
import { ClerkOrganizationControls } from "../../auth-controls";

export const dynamic = "force-dynamic";

const FLOWS = [
  {
    intent: "sso",
    title: "Single sign-on",
    description: "Connect your identity provider (Entra, Okta, Google) so your team signs in with SSO.",
  },
  {
    intent: "dsync",
    title: "Directory sync",
    description: "Provision users and groups automatically from your directory (SCIM).",
  },
  {
    intent: "domain_verification",
    title: "Domain verification",
    description: "Verify ownership of your email domain, required before SSO activates.",
  },
] as const;

/**
 * Identity setup (WP-A). Each button opens the provider's Admin Portal in a
 * fresh single-use session; configuration lives with the provider, never here.
 */
export default async function IdentitySettingsPage() {
  const gate = await tenantAdminContext();
  if (!gate.ok) return <SettingsAccessDenied reason={await settingsDenialReason(gate.reason)} />;
  const provider = identityProviderFromEnv();

  if (provider === "clerk") {
    return (
      <div className="w-full min-w-0 max-w-4xl break-words">
        <h1 className="font-display text-xl font-bold">Identity</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage organization access for {gate.context.tenant.displayName} with Clerk and OpenTenant.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-4 rounded-lg border border-border p-4">
          <ClerkOrganizationControls />
          <Link href="/settings/members" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Manage members
          </Link>
        </div>
      </div>
    );
  }

  if (provider !== "workos") {
    return <div className="w-full min-w-0 max-w-4xl">
      <EmptyState state="unavailable" heading="Identity" description="External identity setup is not configured for this deployment. You can manage tenant invitations and members here."
        action={{ label: "Manage members", href: "/settings/members" }} />
    </div>;
  }

  return (
    <div className="w-full min-w-0 max-w-4xl break-words">
      <h1 className="font-display text-xl font-bold">Identity</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Self-serve setup for {gate.context.tenant.displayName}. Each launch opens a fresh,
        single-use setup session.
      </p>

      <div className="mt-6 space-y-4">
        {FLOWS.map((flow) => (
          <div key={flow.intent} className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground lg:flex-row lg:items-start lg:justify-between">
            <div className="w-full min-w-0 max-w-4xl break-words">
              <h2 className="text-sm font-semibold">{flow.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{flow.description}</p>
            </div>
            <form method="POST" action="/api/settings/identity-portal">
              <input type="hidden" name="intent" value={flow.intent} />
              <button className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                Open setup
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
