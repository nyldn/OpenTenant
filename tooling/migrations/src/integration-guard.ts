/**
 * Shared guard for the destructive migration integration suites.
 *
 * Every suite here begins with `drop schema if exists public cascade`, so the
 * guard exists to make pointing one at a real database an error rather than an
 * incident. Each suite grew its own copy named after the task that introduced
 * it: `opentenant_ops04_`, `opentenant_ops05_`, `opentenant_u31_`,
 * `opentenant_ops06_`. Two of those read the same
 * `CONTROL_PLANE_INTEGRATION_DATABASE_URL` while demanding different prefixes,
 * so a single value could never satisfy both and the pair was unrunnable
 * together. That is part of why no CI job ever ran them, and why migration
 * `0018` shipped as invalid PostgreSQL behind tests that only matched its text.
 *
 * The guard now checks the two things that actually carry the safety: the host
 * is loopback, and the database name is one nothing else would answer to.
 */
const DATABASE_NAME_PREFIX = "opentenant_it_";
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"];

export function integrationDatabaseUrl(variable: string): string | undefined {
  const value = process.env[variable];
  if (!value) return undefined;

  const parsed = new URL(value);
  if (!LOOPBACK_HOSTS.includes(parsed.hostname)) {
    throw new Error(`${variable} must address a loopback host, not ${parsed.hostname}`);
  }
  const database = parsed.pathname.slice(1);
  if (!database.startsWith(DATABASE_NAME_PREFIX)) {
    throw new Error(
      `${variable} must name a database beginning ${DATABASE_NAME_PREFIX}; these suites drop the public schema`,
    );
  }
  return value;
}
