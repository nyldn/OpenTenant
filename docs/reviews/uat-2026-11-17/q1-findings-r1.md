# OpenTenant UAT rerun, wave 7 Q1

Run date: 2026-11-17. Tool: BrowserOS Neo on owner Mac. Build SHA: d818389, branch t3/wave6, development mode, Better Auth. Target: seeded synthetic stack on Forge. Required coverage: 15 journeys at 1440px and 390px. Completed execution: journeys 1-6; journey 7 partial; journeys 8-15 blocked before execution. Separate CDP browser contexts isolate test identities. No application code changes.

Result: BLOCKED. UAT did not pass. Of 30 journey-width checks, 4 pass, 2 fail and 24 are blocked. One verified P2 finding; no P0/P1 established. The approved stack stopped before journeys 7-15 could be completed.

Screen-reader speech has not been checked. Keyboard behavior and DOM/ARIA observations are recorded per journey.

## Journey results

| Journey | 1440px | 390px | Evidence |
|---|---|---|---|
| 1. Signed out, hosts and unknown host | Pass | Pass | j01-*-1440.png and j01-*-390.png; all 8 hosts, Tab/Enter sign-in |
| 2. Cross-tenant private-data boundary | Blocked | Blocked | Tickets return 404 both directions; settings/Assessment/support deny other-owner identity; private asset absent in fixtures |
| 3. Admin overview and audit | Fail | Fail | UAT-020; overview fits, audit region keyboard scrolls, member gets announced denial and Go home |
| 4. Onboarding and provisioning | Blocked | Blocked | Created unique tenants, both invitation messages read back; running→completed without reload. Local failure injection unavailable. |
| 5. Lifecycle and export | Blocked | Blocked | Suspend/resume, API 423, downloads, cancel/confirm/undo deletion succeed. Actual 24h expiry cannot elapse within 8h stack TTL. Exact fixture reset revision 2 verified:true. |
| 6. Managed support | Pass | Pass | Reason/reference session start, operator/expiry banner, persisted routine save, explained restricted denial, safe exit. j06-*.png |
| 7. Tenant settings | Blocked | Blocked | Partial desktop settings inspection; stack stopped before completion |
| 8. Support tickets and states | Blocked | Blocked | Not executed: authorized stack stopped before this journey |
| 9. Assessment, exports and restore | Blocked | Blocked | Not executed: authorized stack stopped before this journey |
| 10. Pending-owner claim | Blocked | Blocked | Not executed: authorized stack stopped before this journey |
| 11. Fresh tenant pages | Blocked | Blocked | Not executed: authorized stack stopped before this journey |
| 12. Hostile tenant | Blocked | Blocked | Not executed: authorized stack stopped before this journey |
| 13. Member permissions | Blocked | Blocked | Not executed: authorized stack stopped before this journey |
| 14. No memberships | Blocked | Blocked | Not executed: authorized stack stopped before this journey |
| 15. Better Auth forms | Blocked | Blocked | Not executed: authorized stack stopped before this journey |

## Prior-finding status

| ID | Status | Evidence |
|---|---|---|
| UAT-001 | Fixed | unknown.localhost returns generic Not found at both widths, no stack overlay. screenshots/j01-unknown-1440.png and j01-unknown-390.png |
| UAT-002 | Not retested | Partial evidence: home/admin/Branding text readable. Assessment and all affected themes not retested. |
| UAT-003 | Not retested | Admin header fits 390px, screenshots/j03-admin-390.png. Launcher portion not retested. |
| UAT-004 | Not retested | Not reached before the authorized stack stopped. |
| UAT-005 | Not retested | Back to tenants and automatic running-to-completed update verified in J4. Support/Brain return paths not retested. |
| UAT-006 | Fixed | Typed-name alertdialog, safe Cancel focus, confirmation and cancel scheduled deletion restore active at both widths. screenshots/j05-delete-confirmation-*.png and j05-alpha-deleted-*.png |
| UAT-007 | Not retested | Authenticated owner reaches brand proposals. Upload/review interrupted by network/stack failure; complete workflow not established. |
| UAT-008 | Not retested | Branding fits 390px and saves in J6. Navigation and remaining settings mobile flows not completed. |
| UAT-009 | Not retested | Admin member and managed-support denials explain restrictions with alerts. Owner-removal protection not retested. |
| UAT-010 | Not retested | Not reached before the authorized stack stopped. |
| UAT-011 | Not retested | Not reached before the authorized stack stopped. |
| UAT-012 | Not retested | Not reached before the authorized stack stopped. |
| UAT-013 | Not retested | Not reached before the authorized stack stopped. |
| UAT-014 | Not retested | Not reached before the authorized stack stopped. |
| UAT-015 | Not retested | Development stack only. Production performance budgets not measured. |
| UAT-016 | Fixed | Alpha and Beta logo pickers list only None and OpenTenant public platform default. screenshots/j02-alpha-branding-390.png |
| UAT-017 | Not retested | Not reached before the authorized stack stopped. |
| UAT-018 | Not retested | Branding saved status verified at both widths in J6. Other routine settings saves not retested. |
| UAT-019 | Not retested | Not reached before the authorized stack stopped. |

## New and still-open findings

### UAT-020 · P2 · UX flow

Route: /admin/audit. Final URL: http://admin.localhost:45243/admin/audit. Persona: installation-owner, workspace/admin. Viewports: 1440px and 390px. Build SHA: d818389.

Steps: open Audit log from Platform admin; look for tenant/action/date filters. Expected: filter the audit events as required by journey 3. Actual: the page has only a static audit table, with zero input/select filters. The labeled table region is keyboard focusable and scrolls horizontally, but cannot narrow results. Hypothesis: the audit view renders its initial event list without a filter form. Confidence: high for absence, medium for implementation cause. Screenshots: screenshots/j03-audit-1440.png and j03-audit-390.png. Proposed fix: add labeled tenant/action/date filtering with clear/reset and an announced result count.

## What worked

- All seven signed-out hosts show the right tenant or suspended state. Unknown host returns a generic 404 without cross-tenant details.
- Admin overview fits both widths, and member denial has an alert and a useful Go home action. Audit tables expose a labeled keyboard-scrollable region.
- Synthetic onboarding works at both widths. Job status changes automatically, announces completion through a polite status region, and invitations reach Mailpit.
- Lifecycle confirmation and undo work at both widths. Suspended tenant writes fail with 423. Both tenant export archives download and parse.
- Managed support completes at both widths with visible operator attribution and expiry, routine-save persistence, clear restricted-page denial, and a safe exit.

## Journey evidence

### Journey 1

Pass at 1440px and 390px. Opened workspace, alpha, beta, hostile, fresh, pending, suspended and unknown hosts. Suspended gives a contact-operator message. Unknown gives generic Not found. Sign-in receives a visible Tab outline and Enter reaches the login form. Main/heading semantics exist; no overflow at 390px. Screenshots: screenshots/j01-{host}-{width}.png. Screen-reader speech was not checked.

### Journey 2

Blocked at both widths for the required private-brand-asset proof. Alpha and Beta use separate isolated browser contexts. Each owner can open its own branding and five seeded tickets. The other tenant ticket ID returns HTTP 404 on the owner host. Unauthenticated traversal of the other host reaches sign-in. Reissuing each same synthetic identity on the opposite host denies settings, Assessment and support. No other tenant ticket content was returned. Both brand pickers contain only None and OpenTenant public platform default, fixing UAT-016. The seed defines no private brand asset, so a private retrieval boundary is not established. screenshots/j02-cross-{page}-{width}.png and j02-alpha-branding-390.png. Speech not checked.

### Journey 3

Fail at both widths due to UAT-020. Opened admin overview and Audit log. Seven tenants appear without mobile page overflow. Audit events is a named focusable region; ArrowRight changes horizontal scroll position at 390px. No filter inputs exist. Member on the admin host receives an Access denied alert with Go home and sign-out, without tenant/audit contents. screenshots/j03-admin-*.png, j03-audit-*.png, j03-member-denied-*.png. Create-tenant and lifecycle controls were exercised in journeys 4-5. Helpdesk and remaining navigation controls were not completed. Speech not checked.

### Journey 4

Blocked at both widths only for required local provisioning-failure injection/retry. Created q1-desktop-1117 and q1-mobile-1117 with unique synthetic owners using the form and keyboard Enter. Both reached active with provision completed, attempt 1/5. Mobile was observed running and then completed without reload; role=status aria-live=polite reported Tenant status: active and provision: completed. Mailpit durable API read-back verified both Your tenant invitation messages, intended synthetic recipient and local invitation host, without recording links. No failure control is present in the UI or authorized UAT gateway, so no worker failure or retry proof is claimed. screenshots/j04-desktop-completed-1440.png and j04-mobile-completed-390.png. Speech not checked. Execution caveat: one Mailpit accessibility snapshot included synthetic invitation references in tool output; subsequent Mailpit reads return only redacted summaries. No credentials are stored in this report.

### Journey 5

Blocked at both widths only for actual export-expiry enforcement. Alpha was suspended and resumed at both widths; alpha-owner settings POST returned HTTP 423 during each suspension. Both exports were downloaded through the UI and saved as artifacts/j05-alpha-export-1440.tar.gz and j05-alpha-export-390.tar.gz. Desktop archive is 6,965 bytes; mobile archive is 7,738 bytes, each with 91 JSON members. A limited credential-marker check found no database URI, Better Auth secret label, encrypted_connection or session-cookie marker. The UI states available for 24 hours; waiting for that expiry exceeds the authorized stack lifetime and no clock control is exposed. Expired-download denial is not claimed. Deletion opens an alertdialog, initially focuses Cancel, traps Tab, requires the exact tenant name, and returns focus to the trigger after cancellation. Cancel leaves active unchanged. Confirm sets deleted and schedules erasure 720 hours later; Cancel scheduled deletion restores active and marks erase cancelled. Both widths completed this flow. Screenshots: j05-delete-confirmation-{width}.png and j05-alpha-deleted-{width}.png. Fixture reset revision 1 returned verified:true during this journey; a second reset followed the completed mobile rerun. Speech not checked.

Fixture restoration receipt after journey 5: version 1, reset seed, revision 2, verified true. The app and worker reset is managed by the authorized uat:reset command; no stack start/stop command was issued.

### Journey 6

Pass at 1440px and 390px with managed-support on Alpha. Started a separate 30-minute session at each width with a synthetic reason and Q1 reference, using keyboard Enter. The role=status banner identifies the real operator, tenant, reason, start and expiry. Routine export-filename suffix changes persisted after reload; both were restored to blank with Branding saved status. Members is denied through a role=alert with the routine-support restriction and a Home link. Exit support removes the support banner and returns to the signed-out tenant home without customer content. No mobile document overflow. screenshots/j06-support-save-{width}.png and j06-support-denied-{width}.png. Screen-reader speech not checked.

RESUME journey 7 after BrowserOS closed the isolated test contexts. Journeys 1-6 are recorded and are not repeated. Settings overview, members, Identity unavailable and Connections unavailable were inspected at 1440px before the context loss; no settings mutation was submitted in that pass.

RESUME journey 7 after local SSH tunnel failure. The previous tunnel exited with Operation timed out / Broken pipe; uat:status confirmed the Linux stack still running. Only the same two forwards were reopened with SSH keepalives. The earlier upload and review network failures are infrastructure evidence and are not counted as application findings. Their screenshot is retained as j07-brand-upload-error-1440.png.

### Journey 7, interrupted

RESUME after browser-context and SSH-tunnel interruptions. Blocked at both widths. Desktop inspection reached Settings overview, Members, Identity unavailable with Manage members, Connections unavailable with disabled Connect buttons, Modules controls, Navigation controls, and the authenticated Brand proposals page. The supplied brand upload was a readable 65-byte UTF-8 Markdown file. Upload and review attempts failed during the network/stack interruption; these are not counted as product defects. No successful DNS activation, private-asset retrieval, complete proposal review/apply, policy lock mutation, member invite, module save or navigation save is claimed. No external DNS or provider was contacted.

### Journeys 8-15

Blocked at both widths before execution because the authorized stack stopped. Ticket creation/state changes/mail, Assessment A/B/CSV/JSON/PDF/restore, pending-owner claim, fresh pages, hostile rendering, member/admin operations, no-membership launcher and full Better Auth form journeys were not executed in this rerun. Earlier-run outcomes are not substituted as current evidence.

### External service blocker

At 2026-11-17 19:07Z, authorized pnpm uat:status returned state stopped, remainingSeconds 0 and empty ports. The SSH tunnel reported remote 127.0.0.1:45243 connection refused. This is before the stated expiry of 2026-11-18 01:24Z. The tester did not start or stop the stack. No safe failure-stage line was found in a restricted log read, so the shutdown cause is unknown. Owner restoration is required for the unfinished journeys.

The fixture reset after journey 6 returned revision 3, verified true, before journey 7 began. No successful journey 7 mutation was established before the interruption.

### Artifact verification

All 39 captured PNGs are retained under screenshots. Fifteen initial file writes failed; those exact image bytes were recovered from this task's tool outputs. The 24 initially retained files match the recovered image hashes. The inventory records each filename, byte count and SHA-256 in artifacts/screenshot-inventory.json. The image named j05-delete-confirmation-390-transition.png is an intermediate animation frame; the settled confirmation is j05-delete-confirmation-390.png. The upload-error capture is infrastructure evidence and is not an application finding. Both lifecycle archives remain on the Mac. No Assessment PDF was produced because journey 9 was blocked before execution.

### Cleanup verification

Completed at 2026-11-17 19:16Z. The named test tab group is closed and all three owned browser-context IDs are absent. The private manifest and temporary service-log copy were deleted; the private directory contains zero files. The owned SSH tunnel job stopped with zero surviving processes. Neither local port 45243 nor 33925 has a listener. mac-job list is empty; the report-only audit found zero active jobs, unmanaged development servers or ad hoc containers. The Linux stack was not started or stopped by this tester.

Both lifecycle archives were re-opened locally and all 91 JSON members in each parsed successfully. A bounded check found no other seeded tenant ID in either export. The SHA-256 values are ae551370e2a1440bb0639956a5750ea2aed7fea9c2cb642d2a1b95ad5cd16063 for the desktop archive and d15cc78280fd9d097a9821536703fd5e20111b21eb718c7c733ac59dda802ec1 for the mobile archive. This is a seeded export check, not a general tenant-isolation proof.

The final report is copied to the requested Forge scratchpad/q1-findings.md destination. Screenshots and export artifacts remain only on the Mac.
