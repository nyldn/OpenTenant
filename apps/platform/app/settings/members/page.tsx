import { FormStatus } from "@opentenant/design-system";
import { SettingsForm, SettingsInput, SettingsSelect } from "../_components/settings-form";
import { SettingsAccessDenied, settingsDenialReason } from "../_components/settings-access";
import { identityGateway } from "../../../lib/identity";
import { tenantAdminContext } from "../../../lib/tenant-admin";
import type { TenantId } from "@opentenant/auth";

export const dynamic = "force-dynamic";

/**
 * Tenant member management (spec 4.1 item 2). Reads come straight from the
 * identity provider through the normalized gateway; mutations go through the
 * member action route, which re-authorizes and audits.
 */
export default async function MembersPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  const gate = await tenantAdminContext();
  if (!gate.ok) return <SettingsAccessDenied reason={await settingsDenialReason(gate.reason)} />;
  const { tenant } = gate.context;
  const { error } = await searchParams;
  const messages: Record<string, string> = {
    invite: "Unable to complete the invitation. Check the members list before retrying.",
    email: "Enter a valid email address.",
    last_owner: "Keep at least one active tenant owner.",
    member: "Select a valid member.",
  };
  const message = error && Object.hasOwn(messages, error) ? messages[error] : null;

  const members = await identityGateway().listTenantMembers(tenant.tenantId as TenantId);

  return (
    <div className="w-full min-w-0 max-w-4xl break-words">
      <h1 className="font-display text-xl font-bold">Members</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        People with access to {tenant.displayName}. Roles: admin manages settings and members;
        member uses entitled modules.
      </p>

      {message && <FormStatus status="error">{message}</FormStatus>}

      <SettingsForm endpoint="/api/settings/members" submitLabel="Invite" className="mt-6 max-w-xl space-y-4">
        <input type="hidden" name="op" value="invite" />
        <SettingsInput name="email" label="Email" type="email" required maxLength={254} />
        <SettingsSelect name="role" label="Role" value="tenant_member">
          <option value="tenant_member">member</option><option value="tenant_admin">admin</option>
        </SettingsSelect>
      </SettingsForm>

      <div role="region" aria-label="Tenant members" tabIndex={0} className="mt-6 w-full min-w-0 overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-ring">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.membershipId} className="border-b border-border last:border-0">
                <td className="px-4 py-2">{m.displayName ?? "-"}</td>
                <td className="px-4 py-2 font-mono text-xs">{m.email}</td>
                <td className="px-4 py-2">{m.role}</td>
                <td className="px-4 py-2">{m.status}</td>
                <td className="px-4 py-2 text-right">
                  <SettingsForm endpoint="/api/settings/members" submitLabel="Remove" className="space-y-2">
                    <input type="hidden" name="op" value="remove" />
                    <input type="hidden" name="membershipId" value={m.membershipId} />
                  </SettingsForm>
                </td>
              </tr>
            ))}
            {members.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  No members yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
