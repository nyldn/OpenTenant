import { Button } from "@opentenant/design-system";
import { SettingsInput } from "../../settings/_components/settings-form";

export function AuditFiltersForm({ values }: { values: { tenant: string; action: string; from: string; to: string } }) {
  return <>
    <form method="get" action="/admin/audit" aria-label="Filter audit events" className="mt-6 grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <SettingsInput name="tenant" label="Tenant" value={values.tenant} maxLength={128} help="Exact tenant ID, or platform for installation events." />
      <SettingsInput name="action" label="Action" value={values.action} maxLength={128} help="Exact audit action name." />
      <SettingsInput name="from" label="From date" type="date" value={values.from} help="Inclusive, UTC." />
      <SettingsInput name="to" label="To date" type="date" value={values.to} help="Inclusive, UTC." />
      <div className="flex flex-wrap items-center gap-4 sm:col-span-2 lg:col-span-4">
        <Button type="submit">Filter events</Button>
        <a href="/admin/audit" className="inline-flex min-h-11 items-center underline">Clear filters</a>
      </div>
    </form>
  </>;
}
