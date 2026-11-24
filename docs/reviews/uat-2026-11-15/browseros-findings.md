# BrowserOS Neo UAT findings

Run: 14–15 November 2026, using BrowserOS Neo and Codex GPT-6.1-sol on the
owner's Mac. The tester reached the `pnpm uat:serve --better-auth` stack
(commit `ebbafbb`) on the Linux host through an SSH tunnel. The tester covered
10 personas and 7 synthetic tenants at viewport widths of 1440px and 390px.
Screenshots and PDFs are kept on the Mac under
`~/opentenant-uat-2026-11-14/`. They are not in the repository.

**Result: UAT did not pass.** The run produced 6 P1, 11 P2 and 2 P3 findings.
No P0 was established.

## What worked

- Provisioning a tenant.
- Suspending a tenant, resuming it, and its API returning 423 while suspended.
- Lifecycle export.
- Two Better Auth email invitations, delivered through Mailpit.
- Ticket creation, and tickets moving through all five states.
- Two 25-question Assessment runs. Both CSV and JSON exports parsed. Both
  one-page PDFs were checked visually.
- Restoring an Assessment backup.
- Keeping tenant data separate: alpha's owner could not see any of beta's
  data.

## Journey coverage

| Journey | Desktop | Mobile | Findings |
|---|---|---|---|
| 1. Signed out, all hosts and an unknown host | Fail | Fail | UAT-001, UAT-002 |
| 2. Cross-tenant private-data boundary | Pass | Pass | UAT-016 (branding picker) |
| 3. Admin overview and audit | Fail | Fail | UAT-002, UAT-003 |
| 4. Onboarding and provisioning | Fail | Fail | UAT-005 |
| 5. Lifecycle and export | Fail | Fail | UAT-006 |
| 6. Managed support | Partial | Fail | UAT-008, UAT-009 |
| 7. Tenant settings | Fail | Fail | UAT-007, UAT-008, UAT-012, UAT-016, UAT-018 |
| 8. Support tickets and their states | Fail | Fail | UAT-005 |
| 9. Assessment, exports and restore | Fail | Fail | UAT-002, UAT-011, UAT-014 |
| 10. Pending-owner claim | Blocked | Fail | UAT-010 |
| 11. Pages of a fresh tenant | Fail | Fail | UAT-002, UAT-008, UAT-013 |
| 12. Hostile tenant | Fail | Fail | UAT-002, UAT-003, UAT-008 (no injection observed) |
| 13. Member permissions | Fail | Fail | UAT-003, UAT-009 |
| 14. A user with no memberships | Fail | Fail | UAT-002, UAT-017 |
| 15. Better Auth forms | Fail | Fail | UAT-004, UAT-019 |

A journey fails if it has a UX defect, even when the action itself succeeded.

## Findings

### P1, major

- **UAT-002 · accessibility.**
  - Where: `/`, `/settings/*`, `/assessment`, `/admin`.
  - Problem: text on dark cards is `#111111` on `#111827`, a contrast ratio of
    about 1.06:1. Important text is nearly invisible.
  - Fix: give cards and controls matching foreground tokens in every theme.
  - This matches the automated audit, which found it on 630 scans.
- **UAT-006 · UX flow.**
  - Where: `/admin/tenants/:id`.
  - Problem: one click on "Schedule deletion" marks the tenant deleted and
    schedules its erasure. There is no confirmation step and no way to cancel.
  - Fix: add a confirmation step, and a cancel/restore action during the
    retention period.
- **UAT-007 · bug.**
  - Where: `/admin/tenants/:id/brand-proposals`, `/settings/branding`.
  - Problem: tenant Branding shows only the basic fields. When the
    installation owner opens Brand proposals while signed in through Better
    Auth, they are sent back to sign-in. The `brand.md` upload, review and
    apply workflow cannot be reached.
- **UAT-008 · mobile.**
  - Where: `/settings/*` at 390px.
  - Problem: the fixed sidebar leaves about 100px for content. Branding and
    Navigation expand to 608px, which pushes fields and actions off-screen.
  - Fix: use mobile navigation and stacked form containers that shrink to fit.
- **UAT-010 · UX flow.**
  - Where: Better Auth sign-up on the pending tenant, reached from the
    invitation email.
  - Problem: submitting the account-creation form replaces it with "Identity
    request failed", and the ownership claim is left incomplete.
  - Not yet known: whether the cause is the application or the test fixture.
- **UAT-011 · bug.**
  - Where: `/assessment`.
  - Steps: save client A with all scores at 3, choose New, then save client B
    with all scores at 4.
  - Problem: client B keeps client A's respondent and scores 3.5 across two
    respondents. The JSON export contains both.
  - Fix: keep a new engagement separate from a draft reset, and aggregate
    scores per engagement.

### P2, minor

- **UAT-001 · security.**
  - Problem: an unknown host triggers a `notFound()` runtime error in the root
    layout. In dev mode this exposes the Next.js version and the stack
    overlay.
  - Fix: reject unknown hosts before the root layout renders, and return a
    generic 404.
- **UAT-003 · mobile.**
  - Where: `/` and `/admin` at 390px.
  - Problem: the account text overlaps. The launcher is 420px wide and the
    admin header 738px, which hides actions, sign-out included.
- **UAT-004 · UX flow.**
  - Problem: bad credentials on the Better Auth login replace the form with
    raw JSON reading "Identity request failed". There is no alert or live
    region, and no way to retry.
- **UAT-005 · UX flow.**
  - Where: `/admin/tenants/:id`, `/support` and `/brain`.
  - Problem: these pages have no way back to the rest of the app. Provisioning
    job progress only updates when the page is refreshed by hand.
- **UAT-009 · UX flow.**
  - Problem: when an admin tries to remove an owner, the response is a bare
    "forbidden". Members are redirected to restricted settings without
    explanation, and managed-support sessions see empty main areas.
  - Fix: show one consistent permission-denied pattern that is announced to
    screen readers.
- **UAT-012 · UX flow.**
  - Problem: the TXT value for a custom domain disappears after navigating
    away. Failed verification does not show it again.
- **UAT-013 · UX flow.**
  - Problem: `/brain` shows only a sentence about the API. It has no UI, empty
    state or link back.
- **UAT-015 · performance (dev mode).**
  - Observed: `/settings` took 4.22s, `/settings/navigation` 4.26s and beta's
    `/` 3.06s.
  - Next step: re-measure on a production build.
- **UAT-016 · privacy.**
  - Problem: the Branding logo list shows "Example Organisation", the
    installation workspace's tenant name, to other tenants.
  - Not established: whether any private asset is accessible.
- **UAT-017 · UX flow.**
  - Problem: a user with no memberships lands on `/tenants`, which offers no
    way to request access, accept an invitation or sign out.
- **UAT-019 · visual.**
  - Problem: the Better Auth forms use raw, browser-styled controls, and the
    labels wrap badly on mobile.

### P3, polish

- **UAT-014 · copy.**
  - Problem: the Assessment profile says "Insurance client profile" even for
    general industries.
  - Problem: "Original legacy recovery" and migration-version text appear
    during normal use.
- **UAT-018 · copy.**
  - Problem: saving routine settings shows no confirmation and announces no
    status.

## Not covered

- The branding proposal workflow, blocked by UAT-007.
- Completing the pending-owner claim, blocked by UAT-010.
- Identity setup and external connections, which are disabled locally.
- Successful DNS activation.
- Provisioning failure and retry states.
- A hostile payload actually executing.
- Screen-reader speech. Only ARIA roles were inspected.
- Final reset checks. The UAT stack reached its 2-hour background limit and
  stopped before these ran. Its synthetic data was discarded on teardown.
