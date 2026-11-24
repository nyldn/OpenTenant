// Threat model: stop ad-hoc and accidental configuration reads. Deliberate
// obfuscation is caught by review and by the sandbox boundary for untrusted
// modules. This lint boundary is not a JavaScript security sandbox.
// Accepted residuals are tested by ID in tooling/ci/runtime-env.test.mjs.
export const acceptedEnvironmentResiduals = [
  { id: "module-this", reason: "Module top-level this, including lexical arrows, is undefined in strict-mode ESM." },
  { id: "module-arguments", reason: "ESM has no module arguments binding and strict functions cannot expose caller/callee. In .cjs files the CommonJS wrapper's arguments can be indexed to reach require/module, which only code written to reach into the loader wrapper does." },
  { id: "prototype-constructor", reason: "Reconstructing a code compiler through prototype traversal or splitting/computing constructor lookups is deliberate obfuscation that review would plainly reject." },
  { id: "browser-back-reference", reason: "Recovering a global through document.defaultView or an event target, then looking up process, is deliberate ambient-state bypass code that review would plainly reject." },
  { id: "procfs-environ", reason: "Reading /proc/self/environ reconstructs the environment from the operating system's process table instead of configuration; only code written to recover ambient state does this, and it is Linux-specific." },
];

const configurationMessage = "Pass configuration as a parameter; application composition reads lib/server-config.ts.";
const ambientModules = /^(node:)?(process|module)$/;
export const runtimeEnvironmentRules = {
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  "no-with": "error",
  // Scope-aware: object keys and local variables named window are not
  // references to ambient globals. Aliasing, destructuring and typeof are.
  "no-restricted-globals": ["error", ...["globalThis", "global", "self", "window", "eval", "Function"].map(name => ({
    name, message: "Use the reviewed runtime-globals helpers instead of ambient global objects or code generation.",
  })), ...["require", "module", "exports"].map(name => ({
    // ESM runtime source has no CommonJS loader; any reference (call, alias,
    // require.main, module.require) is an ambient module-loading path.
    name, message: "Use static ESM imports; CommonJS loaders can reach process and module state.",
  }))],
  "no-restricted-imports": ["error", {
    paths: [
      ...["node:process", "process", "node:module", "module"].map(name => ({ name, message: configurationMessage })),
      // String evaluation and inline workers run code with full process access.
      ...["node:vm", "vm", "node:worker_threads", "worker_threads", "node:inspector", "inspector", "node:inspector/promises", "inspector/promises"].map(name => ({
        name, message: "Runtime source must not evaluate code strings or start inline workers; move such code to reviewed tooling.",
      })),
      // Children would inherit the environment; use @opentenant/security/subprocess.
      ...["node:child_process", "child_process"].map(name => ({
        name, message: "Start child processes only through @opentenant/security/subprocess, which passes a scrubbed environment.",
      })),
    ],
  }],
  "no-restricted-syntax": ["error",
    {
      selector: "MemberExpression[object.name='process'][computed=true], MemberExpression[object.name='process'][property.name=/^(env|getBuiltinModule|mainModule|binding|_linkedBinding|dlopen|report)$/]",
      message: configurationMessage,
    },
    {
      selector: `CallExpression[callee.name='require'][arguments.0.value=${ambientModules}], ImportExpression[source.value=${ambientModules}], ImportExpression[source.value=/^(node:)?(vm|worker_threads|inspector|inspector\\/promises|child_process)$/]`,
      message: configurationMessage,
    },
    {
      selector: "ImportExpression[source.type!='Literal'], ImportExpression[source.type='Literal'][source.raw=/^[^\"']/]",
      message: "Dynamic imports must use a literal module name for review.",
    },
    {
      selector: "MemberExpression:matches([property.name='constructor'], [property.value='constructor'])[object.type='MemberExpression']:matches([object.property.name='constructor'], [object.property.value='constructor']), MemberExpression:matches([property.name='constructor'], [property.value='constructor']):matches([object.type='FunctionExpression'], [object.type='ArrowFunctionExpression'])",
      message: "Do not recover code-generating constructors from other objects.",
    },
    {
      // EventEmitter methods return process itself, and non-arrow listeners
      // receive process as this; both are ordinary ways to reach process.env.
      selector: "CallExpression[callee.object.name='process'][callee.property.name=/^(on|once|addListener|prependListener|prependOnceListener|removeListener|off|removeAllListeners|setMaxListeners)$/]:not(ExpressionStatement > CallExpression), CallExpression[callee.object.name='process'] > :matches(FunctionExpression, FunctionDeclaration).arguments, CallExpression[callee.object.name='process'][callee.property.name='emit']",
      message: "Register process listeners as statements with arrow functions; never keep the returned process or use this.",
    },
    {
      // The subprocess test seam must not widen the runtime command set.
      selector: "Property[key.name='allowedCommands']",
      message: "Runtime callers use the reviewed RUNTIME_COMMANDS set; allowedCommands is a test seam.",
    },
    {
      // A bare process can alias every process API, including env. Preserve
      // unrelated property names, but not computed keys such as object[process].
      selector: "Identifier[name='process']:not(MemberExpression > Identifier.object):not(MemberExpression[computed=false] > Identifier.property):not(Property[computed=false] > Identifier.key):not(TSPropertySignature[computed=false] > Identifier.key):not(PropertyDefinition[computed=false] > Identifier.key):not(ImportSpecifier > Identifier):not(ImportDefaultSpecifier > Identifier):not(ImportNamespaceSpecifier > Identifier)",
      message: configurationMessage,
    },
  ],
};

// Single inventory of environment lint exemptions. Runtime entrypoints are never exempt.
export const environmentExclusions = [
  { path: "apps/platform/lib/server-config.ts", reason: "Typed application configuration boundary, including Next build and edge projections." },
  { path: "packages/security/src/subprocess.ts", reason: "Single reviewed child-process boundary; children receive a fixed search path and explicit variables only, never the parent environment." },
  { path: "packages/create-opentenant/src/cli.ts", reason: "Adopter-run scaffolding CLI in the user's own shell; its pnpm install must inherit the user's registry and proxy settings. Never imported by application runtime." },
  { path: "packages/create-opentenant/src/index.ts", reason: "Scaffolder library used only by the create-opentenant CLI to inspect packed tarballs; never imported by application runtime." },
  { path: "packages/platform-core/src/runtime-globals.ts", reason: "Reviewed narrow browser operations and symbol-keyed process singletons; never exposes a global object or environment." },
  { path: "**/*.test.*", reason: "Tests inject and restore synthetic environment fixtures." },
  { path: "**/*.spec.*", reason: "Browser tests configure synthetic fixtures." },
  { path: "apps/platform/test/**", reason: "Test helpers configure synthetic fixtures." },
  { path: "packages/database/src/operator-config.ts", reason: "Typed operator configuration for audit and key rotation CLIs; not exported to runtime consumers." },
  { path: "packages/auth-better-auth/src/generate-migration.ts", reason: "Standalone operator schema compiler reads one disposable loopback database URL, validates it before connecting, and never runs in the application." },
];
// Next instrumentation has two inline exceptions for literal NEXT_RUNTIME reads:
// Next's bundler must erase Node imports from the edge bundle before evaluation.
// Root scripts and tooling are outside application runtime scope. Their process
// environments also carry child-process transport settings, not application config.

// V1 reviewed inventory. Exact paths and per-file ceilings prevent new reads in
// broadly excluded tests/tooling. Lower ceilings when removing a read. Counts
// include writes/spreads/aliases conservatively; source strings are not executed.
export const environmentReadExceptions = [
  ...Object.entries({
    ".agents/skills/archify/bin/archify.mjs": 2,
    ".agents/skills/archify/bin/preview.mjs": 1,
    ".agents/skills/archify/bin/visual-check.mjs": 3,
    ".agents/skills/archify/renderers/shared/brand-marks.mjs": 3,
    ".agents/skills/archify/renderers/shared/cli.mjs": 2,
    ".agents/skills/archify/renderers/shared/diagnostics.mjs": 1,
    ".agents/skills/archify/renderers/shared/geometry.mjs": 1,
    ".agents/skills/archify/renderers/workflow/render-workflow.mjs": 1,
    ".agents/skills/archify/scripts/check-update.mjs": 3,
    ".agents/skills/archify/test/brand-marks.test.mjs": 7,
    ".agents/skills/archify/test/checkout-line-endings.test.mjs": 1,
    ".agents/skills/archify/test/clean-skill-staging.test.mjs": 1,
    ".agents/skills/archify/test/cli.test.mjs": 8,
    ".agents/skills/archify/test/desktop-reader-browser.test.mjs": 1,
    ".agents/skills/archify/test/i18n.test.mjs": 2,
    ".agents/skills/archify/test/offline-font-browser.test.mjs": 1,
    ".agents/skills/archify/test/output-path.test.mjs": 3,
    ".agents/skills/archify/test/readme-showcase.test.mjs": 2,
    ".agents/skills/archify/test/real-repository-proof.test.mjs": 2,
    ".agents/skills/archify/test/release-package-gates.test.mjs": 3,
    ".agents/skills/archify/test/repository-evidence.test.mjs": 1,
    ".agents/skills/archify/test/semantic-radar.test.mjs": 1,
    ".agents/skills/archify/test/site-language-continuity.test.mjs": 2,
    ".agents/skills/archify/test/site-language-integration.mjs": 3,
    ".agents/skills/archify/test/update-notifier.test.mjs": 3,
    ".agents/skills/archify/test/viewer-chrome-layout.test.mjs": 1,
    ".agents/skills/archify/test/webm-artifact.smoke.mjs": 8,
    ".agents/skills/archify/test/workflow-compiler-hard-contract.test.mjs": 4,
    ".agents/skills/archify/test/workflow-migration.test.mjs": 1,
  }).map(([path, maxReads]) => ({ path, maxReads, reason: "Vendored developer skill tooling and its tests; never imported by application runtime." })),
  ...Object.entries({
    "apps/platform/app/api/mcp/developer-mcp-surface.test.ts": 1,
    "apps/platform/lib/authz-outbox.integration.test.ts": 1,
    "apps/platform/lib/custom-domains.integration.test.ts": 1,
    "apps/platform/lib/provisioning-postgres.integration.test.ts": 2,
    "apps/platform/lib/tenant-activity.test.ts": 1,
    "apps/platform/lib/tenant-export.integration.test.ts": 1,
    "modules/brain/src/host-api.test.ts": 12,
    "modules/support/src/delivery.integration.test.ts": 1,
    "modules/support/src/support-ai-review.integration.test.ts": 4,
    "packages/database/src/admission-store.integration.test.ts": 2,
    "packages/database/src/audit-checkpoints.integration.test.ts": 3,
    "packages/database/src/credential-cipher-rotation.postgres.test.ts": 1,
    "packages/database/src/helpdesk-projection-store.integration.test.ts": 1,
    "packages/database/src/module-capability-store.integration.test.ts": 1,
    "packages/database/src/module-ownership-store.integration.test.ts": 1,
    "packages/database/src/quality-contract-store.integration.test.ts": 3,
    "packages/database/src/usage-ledger.integration.test.ts": 2,
    "packages/developer-mcp/src/brain.integration.test.ts": 2,
    "packages/developer-mcp/src/oauth.integration.test.ts": 2,
    "packages/developer-mcp/src/runtime.integration.test.ts": 2,
    "packages/notifications/src/mailpit.integration.test.ts": 3,
    "packages/observability/src/pg.integration.test.ts": 1,
    "packages/sandbox/src/providers/microsandbox/local.integration.test.ts": 4,
    "packages/security/src/checkpoint-sinks.test.ts": 4,
    "packages/security/src/subprocess.test.ts": 2,
    "packages/testing/src/isolation-fuzz.test.ts": 8,
    "packages/testing/src/smtp.integration.test.ts": 3,
    "packages/usage-export/src/job.integration.test.ts": 1,
    "tooling/ci/fixtures/packed-adopter.test.tsx": 1,
    "tooling/ci/runtime-env-inventory.test.mjs": 1,
    "tooling/e2e/safety.test.mjs": 1,
    "tooling/e2e/specs/authorization-sync.spec.ts": 3,
    "tooling/e2e/specs/better-auth.spec.ts": 8,
    "tooling/e2e/specs/brand-proposals.spec.ts": 2,
    "tooling/e2e/specs/custom-domains.e2e.spec.ts": 7,
    "tooling/e2e/specs/developer-mcp.spec.ts": 2,
    "tooling/e2e/specs/export-bounds.spec.ts": 1,
    "tooling/e2e/specs/lifecycle.spec.ts": 3,
    "tooling/e2e/specs/managed-support.spec.ts": 1,
    "tooling/e2e/specs/members.spec.ts": 2,
    "tooling/e2e/specs/onboarding.spec.ts": 3,
    "tooling/e2e/specs/persona-a11y.spec.ts": 4,
    "tooling/e2e/specs/quality-contract-binding.spec.ts": 3,
    "tooling/e2e/specs/support-ai-review.spec.ts": 4,
    "tooling/e2e/specs/support-email.spec.ts": 7,
    "tooling/e2e/specs/tenant.spec.ts": 1,
    "tooling/migrations/src/control-plane-admission.integration.test.ts": 1,
    "tooling/migrations/src/control-plane-usage-ledger.integration.test.ts": 1,
    "tooling/unattended/src/process-bounds.test.mjs": 1,
    "tooling/unattended/src/runner.test.mjs": 16,
  }).map(([path, maxReads]) => ({ path, maxReads, reason: "Test-owned synthetic environment fixtures, database proof inputs or explicit child-environment assertions." })),
  ...Object.entries({
    "apps/platform/instrumentation.ts": 2,
  }).map(([path, maxReads]) => ({ path, maxReads, reason: "Two literal NEXT_RUNTIME selectors are required for Next to erase Node imports from the edge bundle." })),
  ...Object.entries({
    "apps/platform/lib/server-config.ts": 6,
  }).map(([path, maxReads]) => ({ path, maxReads, reason: "Typed application configuration boundary, including build and edge projections." })),
  ...Object.entries({
    "docs/adopters/check-links.mjs": 1,
    "packages/testing/scripts/isolation-proof.mjs": 7,
    "scripts/assert-quality-pipeline.mjs": 1,
    "scripts/dx-timed-container.mjs": 2,
    "scripts/dx-timed.mjs": 4,
    "scripts/prove-packed-module.mjs": 1,
    "scripts/release-local-container.mjs": 3,
    "scripts/release-local-proof.mjs": 5,
    "scripts/restore-drill.mjs": 10,
    "scripts/scaffold-start-check.mjs": 1,
    "scripts/smoke-deploy.mjs": 5,
    "scripts/update-archify.mjs": 5,
    "tooling/build/check-packages.mjs": 1,
    "tooling/ci/create-integration-databases.mjs": 1,
    "tooling/ci/db-sequence.mjs": 4,
    "tooling/ci/db-sequence-node-proofs.mjs": 1,
    "tooling/ci/db-sequence-smtp-proof.mjs": 2,
    "tooling/ci/mcp-brain-proof.mjs": 1,
    "tooling/ci/rls-proof.mjs": 1,
    "tooling/ci/run-database-store-tests.mjs": 5,
    "tooling/ci/run-local-postgres-proof.mjs": 10,
    "tooling/ci/vercel-preview.mjs": 1,
    "tooling/db-ephemeral/cli.mjs": 2,
    "tooling/db-ephemeral/postgres.mjs": 4,
    "tooling/db-ephemeral/relay.mjs": 4,
    // V2 route proof: assigned ports, canary seeding and whole-environment secret scans.
    "tooling/proofs/developer-mcp-route.mjs": 14,
    "tooling/proofs/docker.mjs": 1,
    "tooling/proofs/microvm-container.mjs": 4,
    "tooling/proofs/microvm.mjs": 1,
    "tooling/proofs/smtp.mjs": 1,
    "tooling/provisioning/src/seed-worker-e2e.mjs": 1,
  }).map(([path, maxReads]) => ({ path, maxReads, reason: "Standalone build, proof or developer CLI transports shell settings and synthetic endpoints; never imported by application runtime." })),
  ...Object.entries({
    "packages/auth-better-auth/src/generate-migration.ts": 1,
  }).map(([path, maxReads]) => ({ path, maxReads, reason: "Standalone schema compiler validates one disposable loopback database URL; not application runtime." })),
  ...Object.entries({
    "packages/database/src/operator-config.ts": 1,
  }).map(([path, maxReads]) => ({ path, maxReads, reason: "Typed configuration boundary for standalone audit and key rotation operators; not application runtime." })),
  ...Object.entries({
    "tooling/e2e/audit/collection-reporter.ts": 5,
    "tooling/e2e/audit/run.mjs": 2,
    "tooling/e2e/audit/scan.ts": 2,
    "tooling/e2e/domain-route.ts": 5,
    "tooling/e2e/global-setup.ts": 1,
    "tooling/e2e/local-fetch.mjs": 2,
    "tooling/e2e/next-server.mjs": 4,
    "tooling/e2e/platform-server.mjs": 4,
    "tooling/e2e/production/assessment.config.ts": 2,
    "tooling/e2e/production/fixtures.ts": 3,
    "tooling/e2e/production/run.mjs": 2,
    "tooling/e2e/production/stack.mjs": 2,
    "tooling/e2e/playwright.config.ts": 5,
    "tooling/e2e/provision-fixtures.mjs": 6,
    "tooling/e2e/provisioned-database.ts": 1,
    "tooling/e2e/run-phase.mjs": 11,
    "tooling/e2e/run.mjs": 3,
    "tooling/e2e/specs/fixtures.ts": 3,
    "tooling/e2e/specs/operations.ts": 2,
    "tooling/e2e/tenants.mjs": 3,
    "tooling/uat/seed.mjs": 4,
    "tooling/uat/serve.mjs": 3,
    "tooling/uat/service-postgres.mjs": 2,
    "tooling/uat/test-stack.mjs": 4,
  }).map(([path, maxReads]) => ({ path, maxReads, reason: "Local browser fixture launcher or scanner transports provisioned test endpoints; never imported by application runtime." })),
  ...Object.entries({
    "tooling/migrations/src/hosted.mjs": 1,
    "tooling/migrations/src/integration-guard.ts": 1,
    "tooling/migrations/src/local.mjs": 6,
  }).map(([path, maxReads]) => ({ path, maxReads, reason: "Operator migration entrypoint or guarded test database configuration; never imported by application runtime." })),
  ...Object.entries({
    "tooling/unattended/src/postgres-proof.integration.mjs": 1,
    "tooling/unattended/src/preflight.mjs": 5,
    "tooling/unattended/src/runner-agent.mjs": 3,
    "tooling/unattended/src/runner-git-state.mjs": 2,
    "tooling/unattended/src/runner-orchestration.mjs": 2,
    "tooling/unattended/src/runner-verification.mjs": 1,
  }).map(([path, maxReads]) => ({ path, maxReads, reason: "Developer proof controller transports bounded child-process settings; never imported by application runtime." })),
];
