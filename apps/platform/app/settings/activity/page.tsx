import { EmptyState } from "@opentenant/design-system";
import { SettingsAccessDenied, settingsDenialReason } from "../_components/settings-access";
import { loadTenantActivity } from "../../../lib/tenant-activity";

export const dynamic = "force-dynamic";

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

/** Recent tenant-safe activity; the shared settings layout owns the redirect boundary. */
export default async function ActivitySettingsPage() {
  const result = await loadTenantActivity();
  if (result.status === "denied") return <SettingsAccessDenied reason={await settingsDenialReason(result.reason)} />;

  if (result.status === "unavailable" || result.records.length === 0) {
    return <div className="w-full min-w-0 max-w-4xl">
      <EmptyState state={result.status === "unavailable" ? "unavailable" : "empty"} heading="Recent activity"
        description={result.status === "unavailable" ? "Activity is temporarily unavailable. Try again later. You can continue reviewing other settings." : "No recent activity to show. Try again later after an administrator makes a visible settings change."}
        action={{ label: "Review settings overview", href: "/settings" }} />
    </div>;
  }

  return (
    <div className="w-full min-w-0 max-w-4xl break-words">
      <h1 className="font-display text-xl font-bold">Recent activity</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Up to 100 of the newest visible settings events for {result.tenantName}.
      </p>

        <ol className="mt-6 divide-y divide-border rounded-lg border border-border bg-card text-card-foreground">
          {result.records.map((record) => (
            <li key={record.sequence} className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">{record.summary}</h2>
                <time
                  dateTime={record.occurredAt}
                  className="text-xs text-muted-foreground"
                >
                  {formatTimestamp(record.occurredAt)} UTC
                </time>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Actor: <span className="text-foreground">{record.actor}</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Affected resource: {record.subject}</p>
            </li>
          ))}
        </ol>
    </div>
  );
}
