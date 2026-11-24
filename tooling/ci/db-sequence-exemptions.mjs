// Reviewed non-database fixtures and separately required proof jobs. No globs.
export const DATABASE_TEST_EXEMPTIONS = [
  { path: "tooling/unattended/src/postgres-proof.integration.mjs", reason: "Owns fresh restricted-controller Docker clusters. The mandatory database-store-proof job runs db-sequence-node-proofs with exactly 2 cases and zero skips." },
  { path: "tooling/db-ephemeral/lifecycle.integration.mjs", reason: "Owns fresh Docker clusters including a deliberate controller SIGKILL. The mandatory database-store-proof job runs db-sequence-node-proofs with exactly 2 cases and zero skips." },
  { path: "tooling/e2e/global-setup.ts", reason: "Browser fixture setup imports Playwright request and provisions the mandatory e2e job; not a test suite or a standalone Vitest file." },
  { path: "tooling/ci/db-sequence-inventory.test.mjs", reason: "Static discovery probes contain synthetic database variable names; no database connection is opened." },
  {
    "path": "apps/platform/app/admin/tenants/[tenantId]/brand-proposals/page.test.tsx",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "apps/platform/app/api/admin/brand-proposals/route.test.ts",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "apps/platform/app/api/admin/support-policy/route.test.ts",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "apps/platform/app/api/ready/route.test.ts",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "apps/platform/app/api/settings/routine-configuration/route.test.ts",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "apps/platform/lib/admission.test.ts",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "apps/platform/lib/brand-proposal-read-model.test.ts",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "apps/platform/lib/control-plane.test.ts",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "apps/platform/lib/helpdesk.test.ts",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "apps/platform/lib/module-capability-broker.test.ts",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "apps/platform/lib/module-registry.test.ts",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "apps/platform/lib/module-services.test.ts",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "apps/platform/lib/provisioning.test.ts",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "apps/platform/lib/server-config.test.ts",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "apps/platform/lib/tenant-activity.test.ts",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "apps/platform/lib/tenant-suspension-access.test.ts",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "apps/platform/lib/tenant.test.ts",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "modules/assessment/src/assessment-results.integration.test.tsx",
    "reason": "React store/results integration uses an in-memory repository and DOM; no PostgreSQL dependency. Runs in the mandatory workspace gate."
  },
  {
    "path": "modules/assessment/src/store.integration.test.tsx",
    "reason": "React store/results integration uses an in-memory repository and DOM; no PostgreSQL dependency. Runs in the mandatory workspace gate."
  },
  {
    "path": "packages/authz/src/openfga.integration.test.ts",
    "reason": "OpenFGA adapter uses an in-memory synthetic HTTP relation server; no database URL or PostgreSQL dependency. Runs in the mandatory workspace gate."
  },
  {
    "path": "packages/notifications/src/mailpit.integration.test.ts",
    "reason": "Real SMTP transport proof is the separate mandatory smtp-proof job with MAILPIT_REQUIRED=1; db-sequence-smtp-proof requires exactly 1 case and zero skips. No PostgreSQL dependency."
  },
  {
    "path": "packages/sandbox/src/providers/microsandbox/local.integration.test.ts",
    "reason": "Real microVM provider proof is the separate mandatory microvm-proof job with its KVM requirement; no PostgreSQL dependency."
  },
  {
    "path": "packages/security/src/checkpoint-sinks.test.ts",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "packages/testing/src/smtp.integration.test.ts",
    "reason": "Requires real Mailpit as well as PostgreSQL. The mandatory smtp-proof CI job sets MAILPIT_REQUIRED=1; db-sequence-smtp-proof runs exactly 3 cases under db:ephemeral with zero skips."
  },
  {
    "path": "tooling/ci/db-sequence.test.mjs",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "tooling/ci/fixtures/packed-adopter.test.tsx",
    "reason": "Packed adopter browser fixture runs in the mandatory create-opentenant local/better-auth container matrix, not the source workspace Vitest runner."
  },
  {
    "path": "tooling/ci/run-database-store-tests.test.mjs",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "tooling/ci/vercel-preview.test.mjs",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "tooling/db-ephemeral/environment.test.mjs",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "tooling/e2e/safety.test.mjs",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "tooling/e2e/specs/custom-domains.e2e.spec.ts",
    "reason": "Browser journey uses provisioned PostgreSQL through the mandatory e2e CI job, with identity-phase collection checks; not a standalone Vitest suite."
  },
  {
    "path": "tooling/e2e/specs/quality-contract-binding.spec.ts",
    "reason": "Browser journey uses provisioned PostgreSQL through the mandatory e2e CI job, with identity-phase collection checks; not a standalone Vitest suite."
  },
  {
    "path": "tooling/e2e/specs/support-ai-review.spec.ts",
    "reason": "Browser journey uses provisioned PostgreSQL through the mandatory e2e CI job, with identity-phase collection checks; not a standalone Vitest suite."
  },
  {
    "path": "tooling/e2e/specs/support-email.spec.ts",
    "reason": "Browser journey uses provisioned PostgreSQL through the mandatory e2e CI job, with identity-phase collection checks; not a standalone Vitest suite."
  },
  {
    "path": "tooling/migrations/src/hosted.test.ts",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "tooling/unattended/src/postgres-proof.test.mjs",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  },
  {
    "path": "tooling/unattended/src/runner.test.mjs",
    "reason": "Synthetic environment fixtures or mocked SQL clients; no live PostgreSQL connection. Runs in the mandatory workspace test gate."
  }
];
