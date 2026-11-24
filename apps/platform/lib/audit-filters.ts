/** Dates are inclusive UTC calendar days; the database upper bound is exclusive. */
export function parseAuditFilters(query: Record<string, string | string[] | undefined>) {
  const value = (name: string) => typeof query[name] === "string" ? query[name].trim() : "";
  const values = { tenant: value("tenant"), action: value("action"), from: value("from"), to: value("to") };
  const { tenant, action, from, to } = values;
  const date = (input: string) => /^\d{4}-\d{2}-\d{2}$/.test(input) && Number.isFinite(Date.parse(input)) && new Date(input).toISOString().slice(0, 10) === input;
  const invalid = !!(tenant.length > 128 || action.length > 128 || (from && !date(from)) || (to && !date(to)) || (from && to && from > to));
  const filters = invalid ? {} : {
    ...(tenant ? { tenantId: tenant === "platform" ? null : tenant } : {}),
    ...(action ? { action } : {}),
    ...(from ? { from: new Date(`${from}T00:00:00.000Z`) } : {}),
    ...(to ? { to: new Date(Date.parse(`${to}T00:00:00.000Z`) + 86_400_000) } : {}),
  };
  return { values, invalid, filters };
}
