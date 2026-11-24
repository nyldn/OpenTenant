import { readdirSync } from "node:fs";
export const PHASES = {
  legacy: { provider: "local", count: 16, specs: ["custom-domains.e2e.spec.ts", "proxy.spec.ts", "settings.spec.ts", "support.spec.ts", "support-accessibility.spec.ts", "support-email.spec.ts", "support-ai-review.spec.ts", "tenant.spec.ts", "theming.e2e.spec.ts"] },
  journeys: { provider: "better-auth", count: 43, specs: ["quality-contract-binding.spec.ts", "export-bounds.spec.ts", "admin-accessibility.spec.ts", "brain-state.spec.ts", "assessment.spec.ts", "assessment-accessibility.spec.ts", "assessment-engagement.spec.ts", "lifecycle.spec.ts", "job-status.spec.ts", "managed-support.spec.ts", "members.spec.ts", "authorization-sync.spec.ts", "onboarding.spec.ts", "developer-mcp.spec.ts", "better-auth.spec.ts", "brand-proposals.spec.ts"] },
  reset: { provider: "better-auth", count: 25, specs: ["uat-reset.spec.ts", "application-shell.spec.ts", "unknown-host.spec.ts", "owner-claim.spec.ts", "settings-feedback.spec.ts", "settings-mobile.spec.ts", "branding-assets.spec.ts", "domain-recovery.spec.ts", "permission-states.spec.ts"] },
  audit: { provider: "better-auth", count: 90, specs: ["persona-a11y.spec.ts"] },
  // Built `next start` budgets; only production/run.mjs may execute this phase, never the dev stack.
  production: { provider: "better-auth", count: 6, specs: ["production-budgets.spec.ts"], runner: "production/run.mjs" },
};
export function validateRegistration() {
  const registered = Object.values(PHASES).flatMap(p => p.specs);
  const actual = readdirSync(new URL("../specs/", import.meta.url)).filter(f => f.endsWith(".spec.ts"));
  if (new Set(registered).size !== registered.length || actual.some(f => !registered.includes(f)) || registered.some(f => !actual.includes(f))) throw new Error("Every E2E spec must be registered exactly once in audit/phases.mjs with an explicit identity phase");
}
