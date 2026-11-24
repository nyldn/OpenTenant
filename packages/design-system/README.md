# OpenTenant design system

Shared shadcn/Tailwind primitives and tenant-aware compositions. Marketing impact: none.

## F1 contracts

All exports below are available from `@opentenant/design-system`. Server theme
resolvers should import the pure palette from
`@opentenant/design-system/lib/semantic-palette` to avoid importing client UI.

```ts
type PaletteMode = "light" | "dark";
interface PaletteBrand {
  colorPrimary?: string;
  colorBackground?: string;
  colorForeground?: string;
}
type SemanticPalette = Readonly<Record<`--${string}`, string>>;
function resolveSemanticPalette(brand?: PaletteBrand, mode?: PaletteMode): SemanticPalette;
function contrastRatio(a: string, b: string): number; // validated six-digit hex inputs
```

`tenantBrandStyle(brand: BrandTokens, mode?: PaletteMode): CSSProperties` in
`apps/platform/lib/custom-domains-theme.ts` adds validated body/display fonts.
It emits a complete palette. A valid tenant background takes precedence over the
mode fallback, including when the host forces a dark class. For a mode preview,
omit `colorBackground` from `resolveSemanticPalette`. No theme class change or
layout adoption is needed to fix partial tenant palettes.

Every surface has its own foreground: background (`--foreground`), card,
popover, primary, secondary, muted, accent, destructive, sidebar,
sidebar-primary and sidebar-accent. Success, warning, danger and info have
surface/foreground pairs and text roles. Input boundaries and focus rings meet
3:1 against all resolved surfaces; text pairs and standalone status text meet
4.5:1. Focus uses an opaque ring with a background offset. Disabled primitives
retain their colours and expose native disabled state.

Only six-digit hex colours reach CSS. An unusable foreground moves toward black
or white until it passes every surface. Controls and text roles derive separately
from the brand accent; adjustment is deterministic, with a black/white fallback.
Use `--brand-accent` and `--chart-*` only for decorative/logo/chart accents.
Use `text-primary-text`, `text-accent-text`, `text-danger-text` and the status
roles for copy; `bg-primary text-primary-foreground` is the control pair.
Caller-supplied opacity, colours, surface styles and size overrides require
their own contrast/target review. Charts need labels in addition to colour.

```ts
type FormOutcome =
  | { status: "success"; message: string }
  | { status: "error"; message: string; fieldErrors?: Readonly<Record<string, string>> };
interface SharedFormProps extends Omit<React.ComponentProps<"form">, "onSubmit" | "action"> {
  onSubmit: (data: FormData) => FormOutcome | Promise<FormOutcome>;
  submitLabel: string;
  pendingLabel?: string; // Saving…
  retryLabel?: string;   // Try again
  disabled?: boolean;
}
function SharedForm(props: SharedFormProps): React.JSX.Element;
interface FieldControlProps {
  id: string;
  name: string;
  disabled: boolean;
  "aria-describedby"?: string;
  "aria-invalid": boolean;
  "aria-busy": boolean;
}
interface FormFieldProps {
  name: string;
  label: React.ReactNode;
  help?: React.ReactNode;
  error?: string;
  disabled?: boolean;
  pending?: boolean;
  children: (props: FieldControlProps) => React.ReactNode;
}
function FormField(props: FormFieldProps): React.JSX.Element;
type FormInputProps = Omit<React.ComponentProps<typeof Input>, "id" | "value" | "name" | "children">
  & Omit<FormFieldProps, "children">;
function FormInput(props: FormInputProps): React.JSX.Element;
function FormStatus(props: {
  status: "error" | "success"; children: React.ReactNode;
}): React.JSX.Element;
```

`SharedForm` owns submission, prevents concurrent submits and disables its
fieldset while pending. Supply unique field names and optionally a stable form
`id`; React `useId` supplies the default. Field errors are keyed by field name.
The focused error summary links to `${formId}-${name}`. Help and inline alert
errors are linked by `aria-describedby`. A successful submit announces polite
status. Exceptions show a generic message; return only safe application wording.
The callback must still enforce authorization, same-origin checks, tenant
binding and bounded request parsing at the server boundary.

Keep fields mounted and uncontrolled (`defaultValue`) for retry. `FormInput`
does not accept a controlled `value`. Password inputs are cleared after each
attempt, including failures; safe fields retain their values. Custom children
must forward the supplied control props and use uncontrolled password inputs.
For Radix Select, pass `disabled`/`name` to Select and the ID/ARIA props to
SelectTrigger; Textarea accepts all control props directly. Server-only/native
forms can use FormField without SharedForm and provide their own response state.

```tsx
<SharedForm id="profile" submitLabel="Save" onSubmit={saveProfile}>
  <FormInput name="email" label="Email" help="Use your work address" type="email" required />
  <FormField name="notes" label="Notes">{control => <Textarea {...control} />}</FormField>
</SharedForm>
```

```ts
interface DestructiveConfirmationDialogProps {
  trigger: React.ReactElement;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => Promise<void> | void;
  onSuccess?: () => void;
}
function DestructiveConfirmationDialog(props: DestructiveConfirmationDialogProps): React.JSX.Element;
interface StateAction { label: string; href: string }
interface AccessDeniedProps {
  state: "signed-out" | "forbidden";
  action: StateAction;
  description?: string;
}
function AccessDenied(props: AccessDeniedProps): React.JSX.Element;
interface EmptyStateProps {
  state: "empty" | "unavailable";
  heading: string;
  description: string;
  action: StateAction;
}
function EmptyState(props: EmptyStateProps): React.JSX.Element;
```

The destructive Dialog has `role="alertdialog"`, linked title/description,
initial Cancel focus, a separate explicit confirm action and trigger focus
restoration. Outside clicks do not dismiss it. While pending, dismissal and
duplicate confirmation are blocked. Reject `onConfirm` to keep the dialog open
with a safe alert and retry. L1 owns retention/restore semantics and server
authorization; supply the actual deletion consequences in `description`.

AccessDenied uses Alert; EmptyState uses Empty, with an Alert for unavailability.
Both have an h1 and a required caller-authorized link. Signed out asks for login;
forbidden explains permission; unavailable describes a temporary service state;
empty describes real absence of data. These do not change JSON APIs or grant
access. F2 and the page owners supply shell navigation and allowed destinations.

## Reproducible checks

`pnpm --filter @opentenant/platform exec vitest run lib/custom-domains-theme.test.ts`
tests all colour pairs, malicious CSS and adversarial tenant values, as well as
the literal standalone CSS palettes. Design-system unit tests cover field
linkage, pending/disabled semantics, state headings/actions and button defaults.
`node packages/design-system/src/components/form-field.browser-proof.mjs`
uses the installed workspace Vitest compiler and Playwright in an isolated,
network-blocked Chromium document at 390 and 1440. It verifies focused errors,
stable IDs, retained safe input, cleared password, retry/success, Cancel focus,
Escape/trigger restoration, failed-confirmation retry and computed 44px default targets using the actual platform Tailwind CSS. Its sanitized receipt
is `/tmp/f1-proof/browser.json`. No server is started for that proof.

The required named palette regression is a `test.step` in the existing home
cells (Alpha/Beta/hostile/fresh), retaining frozen audit collection counts.
The theming journey separately checks raw accents, accessible control pairs and
distinct tenant palettes while retaining the injection regression.

## Page adoption remaining

F1 leaves layouts, shell and auth HTTP rendering to their owners. The owner
approved colour-only adoption for newly exposed targets in three files; no
markup, copy, authority or data flow changes. All are isolated in the
`adopt semantic status colours` commit:

| File | Lines | Newly exposed colours adopted |
| --- | --- | --- |
| `apps/platform/app/settings/modules/page.tsx` | 74 | Managed-support warning surface/text/border. |
| `apps/platform/app/admin/page.tsx` | 81 | Domain active/verification status text. |
| `modules/assessment/src/assessment-results.tsx` | 232,254–256,300,351,373,400 | Overall/pillar score text, readiness badges, Moderate gaps, phase text and Governance/Process category text. Chart fills and existing failing categories remain. |
These source locations still need their owner's adoption (line numbers at F1):

| Owner | File | Remaining treatment |
| --- | --- | --- |
| A1 | `apps/platform/app/admin/tenants/[tenantId]/brand-proposals/brand-document-upload-form.tsx:181` | Primary hover opacity and translucent destructive feedback; shared form/status adoption. |
| A1 | `apps/platform/app/admin/tenants/[tenantId]/brand-proposals/page.tsx:204,306` | Control-background destructive token used for text. |
| S1 | `apps/platform/app/settings/branding/page.tsx:68,83,105` | Inline tenant hex previews and translucent swatch boundary; previews need paired copy and raw-accent distinction. |
| S1 | `apps/platform/app/settings/connections/page.tsx:67` | Disabled card opacity. |
| S1 | `apps/platform/app/settings/navigation/page.tsx:54,73` | Disabled control opacity. |
| S5 | `modules/assessment/src/AssessmentSurface.tsx:7` | Local `--primary-foreground: #111827` override. |
| S5 | `modules/assessment/src/assessment-questionnaire.tsx:78,144–184` | Foreground/muted opacity, white overlays, hard-coded completed-step colours and small raw controls. |
| S5 | `modules/assessment/src/assessment-responses.tsx:190,234` | Dimmed text/rows. |
| S5 | `modules/assessment/src/assessment-results.tsx:165–167,221,239,332,400` | Viability/heatmap colours, stale/bottleneck warnings and remaining category colours (including the pre-existing Strategy failure). |
| S5 | `modules/assessment/src/assessment-shell.tsx:102,104,116,190,197` | Hard-coded warning/success colours and disabled/white overlay opacity. |
| S5 | `modules/assessment/src/components/charts.tsx:8–10,59–67` | Decorative chart colours also used as text. Keep chart accents; pair accessible labels separately. |
| S1 | `apps/platform/app/settings/connections/page.tsx:50` | Literal amber health-note text. |
| S2 | `apps/platform/app/admin/audit/page.tsx:50–53` | Literal chain-status text/borders; pre-existing baseline violations. |
| S2 | `apps/platform/app/admin/support/page.tsx:19` | Literal amber managed-support text; pre-existing baseline violation. |
| S2 | `apps/platform/app/admin/tenants/new/page.tsx:102` | Literal red error text. |
| S3 | `modules/support/src/host-page.tsx:39–42` and `host-ticket.tsx:82` | Literal ticket status colours and translucent internal-note surface. |
| F2 | `apps/platform/app/settings/layout.tsx:30` | Literal amber support-banner pair, currently paired but outside semantic tokens. |
| A1 | `packages/auth-better-auth/src/http.ts:18` | All 114 frozen target-size rule instances come from bare auth markup (summary and sign-out button); it has no platform CSS or shared primitive. |

Also adopt semantic text roles wherever pages use `text-primary` or
`text-destructive` as text; those variables describe control backgrounds and
guarantee 3:1 UI boundaries, while the `*-text` roles guarantee 4.5:1.
Native control styling and inline wrappers that bypass primitives remain with
their page owners. F1 does not treat these as passing accessibility results.

## F1 ratchet handoff

The frozen wave-0 baseline had 390 contrast, 114 target-size and 10
scrollable-region-focusable rule instances (514 serious, 5,176 targets).
F1 removes 4,927 target entries without changing any retained entry, cell,
status, destination, tenant or heading expectation. After the approved
colour-only adoption, the final strict scan confirms 42 contrast, 114 target-size
and 10 scroll-focus instances (166 serious, 249 targets). All 702 cells completed
and the comparison passed with zero differences.

The remaining contrast instances are Assessment entry (9), dimensions (9),
results (12), admin audit (6) and admin support (6). These include local
Assessment colour overrides, dimmed copy, category/heatmap colours and literal
admin status text. All 114 target-size instances resolve to the unstyled Better
Auth page, including redirects to it. Scroll-focus instances are admin audit
(4), Assessment results (4) and Support (2). Those page-owned regions remain
unchanged. This is an improving ratchet, not a passing UAT or WCAG certification.

The candidate scan completed all 702 cells before status adoption. Its first
attempt failed on the initial page with a server compile error caused by the
server palette resolver importing the UI barrel. Importing the pure palette
subpath corrected it. The rerun completed with 51 contrast, 114 target-size and
10 scroll-focus instances, including 221 newly exposed status targets in the
three approved adoption files. Those targets were never added to the baseline.
Four candidate 404 cells captured an empty heading during streaming; their
frozen heading expectations were preserved for strict verification.

Security checks use five inspected local Semgrep rules, with zero findings and
no parse diagnostics in F1 files; diagnostics in unchanged files remain.
Source-wide Gitleaks reports 11 unchanged Assessment storage-key matches;
changed-source and packed-artifact scans report zero. An initial broad working
folder scan also found generated fixture/build material, so receipts use a
tracked/new-source snapshot rather than transient private UAT data. No
allowlist, dependency, scanner, fixture schema or frozen helper was changed.
No pre-commit or Promptfoo configuration exists; Trivy is inapplicable because
F1 changes no dependency, container, IaC or deployment artifact. Production npm
audit has zero high/critical findings (five moderate and one low remain).

Graphify was refreshed locally and excluded from commits. Its warnings remain:
missing SQL grammar, files with no extractable symbols and nine missing
source-file metadata fields. Ripwire reports no gating quality regression;
its minor Assessment render complexity increase is the explicit category colour
choice needed to leave pre-existing failing categories to S5. New UI exports
are intentionally awaiting F2/L1/page adoption.

## F1 verification commands

All child-process verification ran inside named, bounded `forge-job` units.
Logs and sanitized proof JSON are local under `/tmp/f1-*` and `/tmp/f1-proof/`.

| Command | Result |
| --- | --- |
| `pnpm --filter @opentenant/platform exec vitest run lib/custom-domains-theme.test.ts` | 6 passed across the new contrast suite and existing root-style suite. Initial red run exposed missing CSS pairs and outdated raw-primary expectations; both corrected. |
| `pnpm --filter @opentenant/design-system exec vitest run` | 9 passed. First run had one attribute-order assertion failure; corrected, then passed. |
| `node packages/design-system/src/components/form-field.browser-proof.mjs` | Passed at 390 and 1440, with actual Tailwind CSS and computed default target sizes. Earlier unstyled behavioral proof also passed. |
| `pnpm exec eslint packages/design-system/src apps/platform/lib/custom-domains-theme.ts apps/platform/lib/custom-domains-theme.test.ts apps/platform/lib/custom-domains-theme.test.tsx tooling/e2e/specs/persona-a11y.spec.ts tooling/e2e/specs/theming.e2e.spec.ts` | Passed after documenting the test-only Node toolchain import. Full package lint also passed afterward. |
| `pnpm --filter @opentenant/design-system build` | Passed before scan and again before final gates. |
| `pnpm a11y:scan --candidate` | Initial compile failure; corrected rerun completed 702 cells. Candidate never replaced the baseline. |
| `pnpm turbo typecheck lint test --concurrency=2` | 115 tasks passed, 84 cached. Existing environment-gated integration suites remain skipped; this is not a database integration proof. |
| `pnpm --filter @opentenant/platform build` | Passed, 29 routes. Existing rate-limiter dynamic-import and Next ESLint-plugin warnings remain. |
| `pnpm package:check` | Passed, 23 public packages, SQL catalogs, publint/ATTW, packed-artifact secret check and 631 SBOM licence entries. |
| `pnpm e2e` | Rerun passed all 722 cases: 20 journey/reset plus 702 strict scan cells, zero skips. First run timed out after 349 scan cells; see both-run notes below. |
| `pnpm a11y:scan` (invoked by full `pnpm e2e`) | Passed all 702 cells, matrix complete, comparison pass with zero differences; 42 contrast / 114 target-size / 10 scroll-focus. |
| `pnpm audit --prod --audit-level high` | Passed: zero high/critical, five moderate and one low. |
| `pnpm docs:links` | Passed: 168 documents, 391 local links, zero failures; external URLs excluded. |
| `git diff --check` | Passed. |
| `semgrep scan --config /tmp/opentenant-semgrep.yaml --metrics off --disable-version-check --exclude graphify-out --exclude node_modules --exclude .next --exclude dist --json --output /tmp/f1-post-adoption-semgrep.json .` | Zero findings on 927 files; 18 parser diagnostics in unchanged files, none in F1. Earlier scoped runs also passed. |
| `gitleaks dir /tmp/f1-changed-source-final --config .gitleaks.toml --redact --no-banner --no-color --report-format json --report-path /tmp/f1-final-gitleaks.json` | Zero findings in the complete changed-source snapshot, including baseline/spec and adoption files. |
| `gitleaks dir /tmp/f1-source --config .gitleaks.toml --redact --no-banner --no-color --report-format json --report-path /tmp/f1-source-gitleaks.json` | Eleven unchanged Assessment storage-key matches. Initial `gitleaks dir .` included generated UAT/build material; that is not the source-only receipt. |
| `graphify query "design-system semantic theme tokens form field accessibility primitives"`; `graphify update .` | Navigation and AST refresh completed; known parser/metadata warnings above. No graph output committed. |
| `ripwire . --pack-task='accessible theme form primitives'`; `ripwire . --quality-delta`; `ripwire . --edit-check=tenantBrandStyle`; `ripwire . --pr-context --max-tokens=2000` | Reuse/contract checks completed. Quality gating zero; optional mode parameter has zero incompatible callers. The bounded relationship report is lexical, not a substitute for tests. |
| `forge-job audit` | Initial and final audits clear. All recorded owned ports closed, controller/manifest absent, workspace containers absent, and F1 units inactive. |

The first full E2E run passed all 20 journey/reset cases and 349 strict scan
cells, then the tenant-owner brand-proposal cell at 768 timed out during
navigation after 120 seconds. Ten cells in that batch did not run and later
batches were not started; the matrix remains incomplete and is not a passing
receipt. The entire `pnpm e2e` command was rerun once on fresh stacks and passed all
722 cases with zero skips. The previously timed-out cell passed in 1.9 seconds. The
initial candidate failure was a compile error. No skipped cell is admitted
into the matrix.
