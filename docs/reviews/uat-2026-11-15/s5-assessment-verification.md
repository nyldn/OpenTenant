# S5 Assessment UI verification

Base: `efa3a1c58`. Local implementation only; no push or provider activation.

## Findings

- Contrast: removed the Assessment-local on-primary override. Score badges,
  selected scores, heatmap cells, completed stages, viability and phase badges
  use complete semantic pairs. Muted copy no longer uses reduced opacity;
  chart legend/category text uses semantic text roles. Panels use card foreground.
- UAT-014: Operating profile and its prompt are general-purpose. Legacy download
  and version details require Advanced recovery. Existing legacy material still
  offers claim/resume. Engagement download/import and verified restore stay visible.
- UX034: the working grid and rail can shrink at 390px, full pillar names wrap,
  and navigation reaches all 25 dimensions without document overflow.
- UX037–UX039: shared FormField labels identify client, department, operating
  profile, date, facilitator, respondent, role and evidence. Help uses the shared
  aria-describedby relationship. Storage errors use FormStatus and safe wording.
- UX042: real Tab traversal and computed CSS confirm the existing DS Back button
  focus is visible. The ring is 3px orange with a 2px white offset. No extra Back
  outline was added. Overflow regions have their own visible focus outline.
- UX043–UX044: F2 already supplies the route h1 while SSR is disabled and while
  the repository load is held behind a Web Lock. No additional loading h1 was
  added. The module's existing h1 takes over after hydration. The heading case's
  base failure is its visible-field assertion, not a newly claimed heading defect.
- E15: completed downloads are read only after Playwright reports success. CSV
  parses through its final byte and matches all 25 dimensions, scores and quoted
  multiline evidence. JSON matches the client, roster and exact score map. PDF
  requires its final EOF/xref marker, strict pdf.js parsing, at least one page and
  expected client/dimension/score text; other engagement content is absent. Export
  menu focus returns to its trigger; PDF retains its button focus; Tab continues.

## Intentional markup, headings and final paths

All three audit IDs are states of the existing `/assessment` route. No route,
redirect, manifest path, API path or authorization boundary changed. Audit marker
queries `?uatStage=dimensions` and `?uatStage=results` remain supported as before.

| Page/state | Markup and heading changes |
| --- | --- |
| assessment | Shared field wrappers, visible labels, generated control IDs and associated help replace placeholder-only fields. Session fields/actions use a wrapping grid. Legacy/version content moves into details/summary labeled Advanced recovery; verified restore stays outside it. Save errors use shared status markup. Demo/status/control colors use semantic pairs. Version text moves from the footer into advanced content. The existing single h1 is unchanged. |
| assessment-dimensions | The common session changes apply. Evidence now uses shared visible labels and associated optional help. Dimension headings change from h4 to h3 below each existing pillar h2. Full rail names wrap instead of truncating. The mobile grid has an explicit shrinkable column. The existing route h1 is unchanged. |
| assessment-results | The common session changes apply. The shared Table DOM stays intact, with a conditional named region and tabindex on the actual overflowing wrapper; fitting tables have neither. The redundant outer heatmap scroll wrapper is removed. Legend text gains a semantic-colored span. Existing h1 and AI Readiness h2 remain unchanged. |
| Responses stage | Roster and matrix use the same conditional Table wrapper treatment. The native clear-all confirmation becomes the shared destructive dialog with Cancel focus and trigger restoration. Existing h1, Responses h2 and tab headings remain unchanged. |

## Dependency approval

The user approved `tooling/e2e/package.json` and `pnpm-lock.yaml` outside S5
ownership for a test-only PDF parser, then selected unpdf instead of pdfjs-dist.
`unpdf@1.4.0` is exact, MIT-licensed and published 2025-10-31. Its bundled pdf.js
is Apache-2.0. It adds no transitive package, native dependency or install script.
The user explicitly approved the optional `@napi-rs/canvas` peer remaining
unresolved. No workspace override was added.

`pnpm install --lockfile-only` changed only the e2e importer and unpdf package
and snapshot: 13 lockfile insertions. Together with the manifest: 2 files,
15 insertions and 1 deletion. The pre-approved phases.mjs registration is its
own commit and raises journeys from 19 to 30 cases.

## Validation

All test and build commands ran inside foreground `forge-job run` units. The
browser command used the shared fixtures and ephemeral pgvector database.

| Command | Result |
| --- | --- |
| `CI=1 pnpm e2e assessment.spec.ts assessment-accessibility.spec.ts assessment-engagement.spec.ts` | 13 passed, 0 failed, 0 skipped. Six axe cells cover all three page states at 390 and 1440 with zero contrast or scroll-region violations. |
| `pnpm --filter @opentenant/assessment test` | 223 tests passed across 17 files. |
| `pnpm turbo typecheck lint test --concurrency=2` | 115 of 115 tasks passed. |
| `pnpm --filter @opentenant/platform build` | Passed. Existing rate-limiter dynamic-import warnings remain. |
| `node scripts/check-module-special-cases.mjs` | Passed, specialCases: 0. |
| `pnpm install --lockfile-only` | Passed; dependency diff is limited to unpdf as described above. |
| `pnpm audit --audit-level high` | Exit 0; 10 moderate findings, zero high or critical. |
| `pnpm audit --prod --audit-level high` | Exit 0; 5 moderate findings, zero high or critical. |
| `git diff --check efa3a1c HEAD` | Passed; repeated after the final autosquash. |
| Immutable-path comparison against `efa3a1c` | Persistence directory, store and D1 engagement spec unchanged. |

The repository gate initially exposed an existing build-order race: E2E unit
collection read Assessment dist while its build cleaned that directory. A
foreground prerequisite build, `pnpm turbo build --filter
@opentenant/assessment --concurrency=2`, resolved it before the successful gate.
No root task configuration changed.

For the negative proof, Assessment source was temporarily restored exactly to
`efa3a1c`, built and tested with the new spec registration and parser retained.
All 11 new cases and the expanded export case failed; immutable D1 passed.
There were zero skips. Source was then restored to the implementation branch.
The heading case fails on base at its visible-label assertion; the SSR and
loading heading assertions already pass. Existing Back-button focus also passes
on base. Those two findings were checked without claiming defects that F2/F1
already resolved.

The final branch browser run passed all 13 cases. Generated graph files are
refreshed locally and excluded from commits. Forge audit reports no unmanaged
servers, completed units are inactive, and all 18 recorded owned listener ports
are closed. Nothing was pushed.

Marketing impact: none.
