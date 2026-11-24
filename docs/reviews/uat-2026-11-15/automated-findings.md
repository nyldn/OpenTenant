# Automated UI, UX and accessibility findings

> Screenshot paths refer to the audit run's local `.uat-audit/screens/` directory; images are not committed.

Audit date: 2026-11-14. Chromium, real local seeded Postgres and Better Auth identities, canonical `tooling/e2e` provisioning/global setup/DNS/server configuration, and isolated loopback Mailpit. The temporary wrapper relocates generated Next/config/report output and resolves package imports from `.uat-audit/`. No tracked application source changes.

## Coverage and evidence

Completed 630 unique scan combinations, with 309 authorized content loads. Screenshots currently saved: 669. Each normal page scenario uses 390x844, 768x1024 and 1440x900 across signed out, tenant owner, admin, member, installation owner and managed-support operator. Redirected and denied pages are preserved, not counted as successful page content. Trailing-slash canonicalization is normalized when matching the requested content. Disposable support-ticket UUIDs are normalized across fixture restarts when merging equivalent page/focus measurements. Assessment dimension/results states, module access, and the local Developer MCP authorization/confirmation forms are additional scenarios. No Developer MCP consent was submitted and no sandbox preview token was issued.

```json
{
  "records": 630,
  "completed": 630,
  "contentReachedCells": 309,
  "screenshots": 669,
  "personas": {
    "signed-out": 105,
    "installation-owner": 105,
    "tenant-owner": 105,
    "admin": 105,
    "member": 105,
    "managed-support": 105
  },
  "coverage": {
    "page": {
      "total": 24,
      "reached": 21,
      "probed": 24
    },
    "route": {
      "total": 40,
      "reached": 14,
      "probed": 40
    }
  },
  "axeRuleInstances": 526,
  "axeNodeInstances": 3899,
  "rules": {
    "color-contrast": 329,
    "target-size": 114,
    "scrollable-region-focusable": 9,
    "document-title": 36,
    "html-has-lang": 38
  },
  "overflowCells": 64,
  "missingTitleCells": 9,
  "missingH1Cells": 22,
  "unlabeledCells": 29,
  "clsOver01": 0,
  "consoleMessages": 116,
  "failedRequests": 5,
  "focusAllControlsCells": 630,
  "findings": 57
}
```

`pages.json` retains every console error/warning, failed request, HTTP error, title/h1, unlabeled control, focus sample, overflow culprit, timing, observed layout shift and axe result. `metrics.csv` is the compact per-cell index. `findings.json` groups page/rule issues; its record number indexes `pages.json`. Screenshots use `{persona}--{route}--{width}.png`.

## Method and limits

- @axe-core/playwright 4.11.0 with axe-core 4.11.4 is installed only under the untracked audit directory. Tags: wcag2a, wcag2aa, wcag21a, wcag21aa and wcag22aa. Each violation includes rule, impact, target, affected-node count, HTML and failure summary. `axeIncomplete` is retained for manual review, never treated as a pass or confirmed failure. This is automated coverage, not WCAG certification.
- Six personas use real fixture identities and invitation-accepted memberships. Tenant owner uses Alpha, installation owner/admin/member use workspace; managed support uses the real workspace operator with an explicitly started Alpha support session. Authorization redirects/404s are expected for disallowed pages. No role was silently elevated to reach a page.
- Browser requests allow only exact loopback/synthetic mapped hosts. The server reuses the harness loopback-only fetch dispatcher and local TLS module stub. API probes disable redirect following. No external IdP, OAuth provider, GitHub, model, or production service was contacted.
- The default harness does not start Mailpit. The untracked wrapper adds a uniquely named pinned local Mailpit container and configures the real identity mail hooks. `mail-evidence.json`, when complete, records HTTP read-back totals. Support Depth email remains a separate library composition.
- Page timing is one local Next development navigation, often including cold compilation, not a production benchmark. `loadMs` comes from Navigation Timing; `wallLoadMs` includes the 350 ms observation settle. Slower cells should be retested on a production build before setting a latency budget.
- Layout-shift observation starts before page code, excludes recent input and sums buffered entries over this short observation. It is a lab diagnostic, not field p75 CLS or a full session-window implementation.
- The original Tab probe stopped early at duplicate Assessment button markup. A supplemental focus-all.jsonl pass keys by DOM position, sets keyboard modality with Tab, and focuses every visible interactive control to capture :focus-visible and outline/shadow/border/background changes. It supplements, rather than replaces, the six keyboard-only form journeys. pages.json merges successful matching focus records; focusAllControlsCells reports coverage. The fixed MCP forms also have complete Tab traces of their three or one visible controls, checked against their static form source. Missing-indicator candidates need manual review of pseudo-elements and are labeled heuristics. Next development-toolbar focus is excluded from product findings.
- The visible-label diagnostic checks labels/aria-label/aria-labelledby/title. A placeholder can still create an accessible name, so these are visible-label UX candidates unless axe independently reports label failure.
- The first matrix run hit a 6 GB job cgroup OOM after 49 completed cells. `oom-evidence.txt` and `attempt-6-oom.log` retain the failure. Valid cells were reused; incomplete cells reran. The 3 GB V8 retry then exhausted its heap during further page compilation, recorded in `attempt-7-heap-limit.log`; its connection-refused records are excluded from findings and rerun. A later 6 GB V8 crawl also exhausted its heap, retained in attempt-9-parallel-heap.log. The final missing-cell run caps V8 at 8 GB within a bounded 12 GB job allocation and measures all controls inline. These failures concern this adapted development audit runner; no production memory-leak conclusion is claimed. Earlier setup failures are preserved in attempt logs. They are harness-wrapper failures, not application UX bugs.

## Ranked findings

P1 means a confirmed serious/critical axe violation or substantial horizontal overflow; P2 means a lesser layout/document-structure issue or a clearly labeled diagnostic candidate. P3 on API denial documents is browser rendering of an expected error body, not application-authored UI. P3 on /m/e2e-stub is a harness-fixture HTML limitation; its tiny upstream stub intentionally has no title or lang, so do not attribute that HTML to platform-authored UI. Repeated shared-token failures are grouped per page/rule. A denied route showing the login page is attributed to its final URL in the title.

### UX001 · P1 · color-contrast on /assessment?uatStage=dimensions

Requested page `/assessment?uatStage=dimensions`, final `/assessment`; tenant-owner; 390x844. Evidence: screens/tenant-owner--assessment-uatStage-dimensions--390.png (`screens/tenant-owner--assessment-uatStage-dimensions--390.png`), record 310 in `pages.json`.
Rule: `color-contrast`. Count: 53. Confidence: automated.
Targets: `[[".mb-1 > span:nth-child(1)"], [".mb-1 > .tabular-nums"], [".mb-4 > .text-\\[14px\\]"], [".tracking-\\[0\\.1em\\].uppercase.text-accent-text"], [".gap-1\\.5.flex-wrap.items-center > .dark\\:border-input.dark\\:hover\\:bg-input\\/50[data-variant=\"outline\"]:nth-child(1)"], [".gap-1\\.5.flex-wrap.items-center > .dark\\:hover\\:bg-accent\\/50.hover\\:bg-accent[data-variant=\"ghost\"]"], [".dark\\:border-input.dark\\:hover\\:bg-input\\/50[data-variant=\"outline\"]:nth-child(3)"], [".dark\\:border-input.dark\\:hover\\:bg-input\\/50[data-variant=\"outline\"]:nth-child(4)"], ["input[placeholder=\"Client / organization\"]"], ["input[placeholder=\"Department\"]"], ["select"], ["input[aria-label=\"Assessment date\"]"], ["input[placeholder=\"Facilitator\"]"], [".max-w-48"], [".max-w-40"], [".text-muted-foreground\\/70.flex-wrap.gap-2 > span"], [".truncate.text-foreground.block"], [".ring-primary\\/40 > .min-w-0.leading-tight > .text-muted-foreground\\/70.block.text-\\[11px\\]"], ["nav > .hover\\:bg-white\\/\\[0\\.03\\].gap-2\\.5.px-2:nth-child(2) > .min-w-0.leading-tight > .text-muted-foreground\\/70.block.text-\\[11px\\]"], [".hover\\:bg-white\\/\\[0\\.03\\].gap-2\\.5.px-2:nth-child(3) > .min-w-0.leading-tight > .text-muted-foreground\\/70.block.text-\\[11px\\]"], [".hover\\:bg-white\\/\\[0\\.03\\].gap-2\\.5.px-2:nth-child(4) > .min-w-0.leading-tight > .text-muted-foreground\\/70.block.text-\\[11px\\]"], [".hover\\:bg-white\\/\\[0\\.03\\].gap-2\\.5.px-2:nth-child(5) > .min-w-0.leading-tight > .text-muted-foreground\\/70.block.text-\\[11px\\]"], [".pb-1"], [".pt-2 > .hover\\:bg-white\\/\\[0\\.03\\].gap-2\\.5.px-2 > .min-w-0.leading-tight > .text-muted-foreground\\/70.block.text-\\[11px\\]"], [".mt-1 > .min-w-0.leading-tight > .text-muted-foreground\\/70.block.text-\\[11px\\]"], [".mt-0\\.5"], [".scroll-mt-28.transition-shadow.p-4:nth-child(1) > .lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_22rem\\].lg\\:items-start.lg\\:gap-6 > .min-w-0 > .flex-wrap.gap-2.items-start > h4"], [".scroll-mt-28.transition-shadow.p-4:nth-child(1) > .lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_22rem\\].lg\\:items-start.lg\\:gap-6 > .min-w-0 > .text-foreground\\/90.mt-2"], ["#radix-_r_0_"], ["#radix-_r_2_"], [".scroll-mt-28.transition-shadow.p-4:nth-child(1) > .lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_22rem\\].lg\\:items-start.lg\\:gap-6 > .lg\\:border-l.lg\\:border-white\\/\\[0\\.06\\].lg\\:pl-6 > textarea"], [".scroll-mt-28.transition-shadow.p-4:nth-child(2) > .lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_22rem\\].lg\\:items-start.lg\\:gap-6 > .min-w-0 > .flex-wrap.gap-2.items-start > h4"], [".scroll-mt-28.transition-shadow.p-4:nth-child(2) > .lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_22rem\\].lg\\:items-start.lg\\:gap-6 > .min-w-0 > .text-foreground\\/90.mt-2"], ["#radix-_r_4_"], ["#radix-_r_6_"], [".scroll-mt-28.transition-shadow.p-4:nth-child(2) > .lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_22rem\\].lg\\:items-start.lg\\:gap-6 > .lg\\:border-l.lg\\:border-white\\/\\[0\\.06\\].lg\\:pl-6 > textarea"], [".scroll-mt-28.transition-shadow.p-4:nth-child(3) > .lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_22rem\\].lg\\:items-start.lg\\:gap-6 > .min-w-0 > .flex-wrap.gap-2.items-start > h4"], [".scroll-mt-28.transition-shadow.p-4:nth-child(3) > .lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_22rem\\].lg\\:items-start.lg\\:gap-6 > .min-w-0 > .text-foreground\\/90.mt-2"], ["#radix-_r_8_"], ["#radix-_r_a_"], [".scroll-mt-28.transition-shadow.p-4:nth-child(3) > .lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_22rem\\].lg\\:items-start.lg\\:gap-6 > .lg\\:border-l.lg\\:border-white\\/\\[0\\.06\\].lg\\:pl-6 > textarea"], [".scroll-mt-28.transition-shadow.p-4:nth-child(4) > .lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_22rem\\].lg\\:items-start.lg\\:gap-6 > .min-w-0 > .flex-wrap.gap-2.items-start > h4"], [".scroll-mt-28.transition-shadow.p-4:nth-child(4) > .lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_22rem\\].lg\\:items-start.lg\\:gap-6 > .min-w-0 > .text-foreground\\/90.mt-2"], ["#radix-_r_c_"], ["#radix-_r_e_"], [".scroll-mt-28.transition-shadow.p-4:nth-child(4) > .lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_22rem\\].lg\\:items-start.lg\\:gap-6 > .lg\\:border-l.lg\\:border-white\\/\\[0\\.06\\].lg\\:pl-6 > textarea"], [".scroll-mt-28.transition-shadow.p-4:nth-child(5) > .lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_22rem\\].lg\\:items-start.lg\\:gap-6 > .min-w-0 > .flex-wrap.gap-2.items-start > h4"], [".scroll-mt-28.transition-shadow.p-4:nth-child(5) > .lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_22rem\\].lg\\:items-start.lg\\:gap-6 > .min-w-0 > .text-foreground\\/90.mt-2"], ["#radix-_r_g_"], ["#radix-_r_i_"], [".scroll-mt-28.transition-shadow.p-4:nth-child(5) > .lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_22rem\\].lg\\:items-start.lg\\:gap-6 > .lg\\:border-l.lg\\:border-white\\/\\[0\\.06\\].lg\\:pl-6 > textarea"], [".text-primary-foreground.hover\\:bg-primary\\/90.h-\\[32px\\]"], ["footer"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 13.5pt (18px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 13.5pt (18px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 13.5pt (18px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.21 (foreground color: #111111, background color: #1b2435, font size: 9.7pt (12.96px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 9.7pt (12.96px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.21 (foreground color: #111111, background color: #1b2435, font size: 9.7pt (12.96px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.21 (foreground color: #111111, background color: #1b2435, font size: 9.7pt (12.96px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.21 (foreground co

### UX002 · P1 · color-contrast on /admin

Requested page `/admin`, final `/admin`; installation-owner; 390x844. Evidence: screens/installation-owner--admin--390.png (`screens/installation-owner--admin--390.png`), record 163 in `pages.json`.
Rule: `color-contrast`. Count: 41. Confidence: automated.
Targets: `[[".gap-3 > span"], ["main > p"], ["section:nth-child(1) > .items-baseline.justify-between.gap-2 > h2"], ["section:nth-child(1) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(1) > ul > li:nth-child(1)"], ["div:nth-child(1) > ul > li:nth-child(2)"], ["section:nth-child(1) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(2) > ul > li:nth-child(1)"], ["section:nth-child(1) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(2) > ul > li:nth-child(2)"], ["section:nth-child(1) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(2) > ul > li:nth-child(3)"], ["section:nth-child(1) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(3) > .mt-1.font-mono.text-xs"], ["section:nth-child(1) > .mt-5.items-end.border-t > div:nth-child(1) > p"], ["section:nth-child(1) > .mt-5.items-end.border-t > .items-center.gap-2.flex-wrap > a:nth-child(1)"], ["section:nth-child(1) > .mt-5.items-end.border-t > .items-center.gap-2.flex-wrap > form[action=\"/api/admin/support-policy\"] > button"], [".bg-primary"], ["section:nth-child(2) > .items-baseline.justify-between.gap-2 > h2"], ["section:nth-child(2) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(1) > ul > li"], ["section:nth-child(2) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(2) > ul > li:nth-child(1)"], ["section:nth-child(2) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(2) > ul > li:nth-child(2)"], ["section:nth-child(2) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(2) > ul > li:nth-child(3)"], ["section:nth-child(2) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(3) > .mt-1.font-mono.text-xs"], ["section:nth-child(2) > .mt-5.items-end.border-t > div:nth-child(1) > p"], ["section:nth-child(2) > .mt-5.items-end.border-t > .items-center.gap-2.flex-wrap > a"], ["section:nth-child(2) > .mt-5.items-end.border-t > .items-center.gap-2.flex-wrap > form[action=\"/api/admin/support-policy\"] > button"], ["section:nth-child(3) > .items-baseline.justify-between.gap-2 > h2"], ["section:nth-child(3) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(1) > ul > li"], ["section:nth-child(3) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(2) > ul > li:nth-child(1)"], ["section:nth-child(3) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(2) > ul > li:nth-child(2)"], ["section:nth-child(3) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(2) > ul > li:nth-child(3)"], ["section:nth-child(3) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(3) > .mt-1.font-mono.text-xs"], ["section:nth-child(3) > .mt-5.items-end.border-t > div:nth-child(1) > p"], ["section:nth-child(3) > .mt-5.items-end.border-t > .items-center.gap-2.flex-wrap > a"], ["section:nth-child(3) > .mt-5.items-end.border-t > .items-center.gap-2.flex-wrap > form[action=\"/api/admin/support-policy\"] > button"], ["section:nth-child(4) > .items-baseline.justify-between.gap-2 > h2"], ["section:nth-child(4) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(1) > ul > li"], ["section:nth-child(4) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(2) > ul > li:nth-child(1)"], ["section:nth-child(4) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(2) > ul > li:nth-child(2)"], ["section:nth-child(4) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(2) > ul > li:nth-child(3)"], ["li:nth-child(4)"], ["section:nth-child(4) > .mt-4.grid.sm\\:grid-cols-3 > div:nth-child(3) > .mt-1.font-mono.text-xs"], ["section:nth-child(4) > .mt-5.items-end.border-t > div:nth-child(1) > p"], ["section:nth-child(4) > .mt-5.items-end.border-t > .items-center.gap-2.flex-wrap > a"], ["section:nth-child(4) > .mt-5.items-end.border-t > .items-center.gap-2.flex-wrap > form[action=\"/api/admin/support-policy\"] > button"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 15.2pt (20.25px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (

### UX003 · P1 · color-contrast on /admin/audit

Requested page `/admin/audit`, final `/admin/audit`; managed-support; 390x844. Evidence: screens/managed-support--admin-audit--390.png (`screens/managed-support--admin-audit--390.png`), record 574 in `pages.json`.
Rule: `color-contrast`. Count: 37. Confidence: automated.
Targets: `[[".font-semibold"], [".rounded-full"], ["p"], ["th:nth-child(1)"], ["th:nth-child(2)"], [".last\\:border-0:nth-child(1) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(2) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(3) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(4) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(5) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(6) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(7) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(8) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(9) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(10) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(11) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(12) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(13) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(14) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(15) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(16) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(17) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(18) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(19) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(20) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(21) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(22) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(23) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(24) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(25) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(26) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(27) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(28) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(29) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(30) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(31) > .whitespace-nowrap.font-mono.text-xs"], [".last\\:border-0:nth-child(32) > .whitespace-nowrap.font-mono.text-xs"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.93 (foreground color: #00d492, background color: #ffffff, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: bold). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: bold). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreg

### UX004 · P1 · color-contrast on /settings/modules

Requested page `/settings/modules`, final `/settings/modules`; installation-owner; 390x844. Evidence: screens/installation-owner--settings-modules--390.png (`screens/installation-owner--settings-modules--390.png`), record 157 in `pages.json`.
Rule: `color-contrast`. Count: 14. Confidence: automated.
Targets: `[[".gap-3.items-center.flex:nth-child(2) > .text-muted-foreground"], ["div > p"], ["section:nth-child(3) > h2"], ["section:nth-child(3) > .mt-4.space-y-3 > label:nth-child(3)"], ["section:nth-child(3) > .mt-4.space-y-3 > label:nth-child(4)"], [".items-start.gap-2.flex:nth-child(2) > span > .font-medium"], ["section:nth-child(3) > .mt-5.space-y-4[action=\"/api/settings/module-access\"] > .bg-primary.text-primary-foreground.px-4"], ["section:nth-child(4) > h2"], ["section:nth-child(4) > .mt-4.space-y-3 > label:nth-child(3)"], ["section:nth-child(4) > .mt-4.space-y-3 > label:nth-child(4)"], ["section:nth-child(4) > .mt-5.space-y-4[action=\"/api/settings/module-access\"] > .bg-primary.text-primary-foreground.px-4"], ["section:nth-child(5) > .mt-4.space-y-3 > label:nth-child(3)"], ["section:nth-child(5) > .mt-4.space-y-3 > label:nth-child(4)"], ["section:nth-child(5) > .mt-5.space-y-4[action=\"/api/settings/module-access\"] > .bg-primary.text-primary-foreground.px-4"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 15.2pt (20.25px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 3.55 (foreground color: #ffffff, background color: #ea580c, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 15.2pt (20.25px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1

### UX005 · P1 · color-contrast on /settings/activity

Requested page `/settings/activity`, final `/settings/activity`; installation-owner; 390x844. Evidence: screens/installation-owner--settings-activity--390.png (`screens/installation-owner--settings-activity--390.png`), record 139 in `pages.json`.
Rule: `color-contrast`. Count: 10. Confidence: automated.
Targets: `[[".gap-3.items-center.flex:nth-child(2) > span"], ["div > p"], [".p-4:nth-child(1) > .flex-wrap.items-baseline.gap-2 > h2"], [".p-4:nth-child(1) > p:nth-child(2) > .text-foreground"], [".p-4:nth-child(2) > p:nth-child(2) > .text-foreground"], [".p-4:nth-child(3) > .flex-wrap.items-baseline.gap-2 > h2"], [".p-4:nth-child(3) > p:nth-child(2) > .text-foreground"], [".p-4:nth-child(4) > .flex-wrap.items-baseline.gap-2 > h2"], [".p-4:nth-child(4) > p:nth-child(2) > .text-foreground"], [".p-4:nth-child(5) > p:nth-child(2) > .text-foreground"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 13.5pt (18px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 13.5pt (18px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 13.5pt (18px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (fore

### UX006 · P1 · color-contrast on /settings/navigation

Requested page `/settings/navigation`, final `/settings/navigation`; installation-owner; 390x844. Evidence: screens/installation-owner--settings-navigation--390.png (`screens/installation-owner--settings-navigation--390.png`), record 160 in `pages.json`.
Rule: `color-contrast`. Count: 10. Confidence: automated.
Targets: `[[".gap-3.items-center.flex:nth-child(2) > .text-muted-foreground"], ["div > p"], ["section:nth-child(3) > h2"], ["section:nth-child(3) > form > .items-start.gap-2.flex > span > .font-medium"], ["section:nth-child(3) > form > .bg-primary.px-4.text-primary-foreground"], ["section:nth-child(4) > h2"], ["section:nth-child(4) > form > .items-start.gap-2.flex > span > .font-medium"], ["section:nth-child(4) > form > .bg-primary.px-4.text-primary-foreground"], ["section:nth-child(5) > form > .items-start.gap-2.flex > span > .font-medium"], ["section:nth-child(5) > form > .bg-primary.px-4.text-primary-foreground"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 15.2pt (20.25px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 3.55 (foreground color: #ffffff, background color: #ea580c, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 15.2pt (20.25px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 3.55 (foreground color: #ffffff, background color: #ea580c, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1

### UX007 · P1 · color-contrast on /admin/tenants/new

Requested page `/admin/tenants/new`, final `/admin/tenants/new`; installation-owner; 390x844. Evidence: screens/installation-owner--admin-tenants-new--390.png (`screens/installation-owner--admin-tenants-new--390.png`), record 175 in `pages.json`.
Rule: `color-contrast`. Count: 8. Confidence: automated.
Targets: `[[".gap-2 > .font-semibold"], ["main > p"], ["label:nth-child(1)"], ["input[type=\"email\"]"], ["input[minlength=\"1\"]"], ["input[minlength=\"2\"]"], ["select"], [".bg-primary"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 3.55 (foreground color: #ffffff, background color: #ea580c, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1

### UX008 · P1 · color-contrast on /support

Requested page `/support`, final `/support`; installation-owner; 390x844. Evidence: screens/installation-owner--support--390.png (`screens/installation-owner--support--390.png`), record 193 in `pages.json`.
Rule: `color-contrast`. Count: 8. Confidence: automated.
Targets: `[["p"], [".grow > span"], ["label:nth-child(2) > span"], ["form > label > span"], [".bg-primary"], ["th:nth-child(1)"], ["th:nth-child(2)"], ["th:nth-child(3)"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 3.55 (foreground color: #ffffff, background color: #ea580c, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.01 (foreground color: #94a3b8, background color: #a0a3a9, font size: 10.1pt (13.5px), font weight: bold). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.01 (foreground color: #94a3b8, background color: #a0a3a9, font size: 10.1pt (13.5px), font weight: bold). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.01 (foreground color: #94a3b8, background color: #a0a3a9, font size: 10.1pt (13.5px), font weight: bold). Expected contrast ratio of 4.5:1

### UX009 · P1 · color-contrast on /

Requested page `/`, final `/`; installation-owner; 390x844. Evidence: screens/installation-owner--home--390.png (`screens/installation-owner--home--390.png`), record 122 in `pages.json`.
Rule: `color-contrast`. Count: 6. Confidence: automated.
Targets: `[[".gap-3.items-center.flex:nth-child(2) > span"], ["main > p"], ["a[href$=\"assessment\"] > .text-lg.font-semibold.font-display"], ["a[href$=\"brain\"] > .text-lg.font-semibold.font-display"], [".rounded-lg.bg-card[href$=\"support\"] > .text-lg.font-semibold.font-display"], [".h-12 > span"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 15.2pt (20.25px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 15.2pt (20.25px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 15.2pt (20.25px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1

### UX010 · P1 · color-contrast on /settings

Requested page `/settings`, final `/settings`; installation-owner; 390x844. Evidence: screens/installation-owner--settings--390.png (`screens/installation-owner--settings--390.png`), record 134 in `pages.json`.
Rule: `color-contrast`. Count: 4. Confidence: automated.
Targets: `[[".gap-3.items-center.flex:nth-child(2) > span"], ["p"], [".rounded-lg.bg-card.p-4:nth-child(1) > dd"], [".rounded-lg.bg-card.p-4:nth-child(2) > dd"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1

### UX011 · P1 · color-contrast on /settings/branding

Requested page `/settings/branding`, final `/settings/branding`; installation-owner; 390x844. Evidence: screens/installation-owner--settings-branding--390.png (`screens/installation-owner--settings-branding--390.png`), record 142 in `pages.json`.
Rule: `color-contrast`. Count: 4. Confidence: automated.
Targets: `[[".gap-3.items-center.flex:nth-child(2) > span"], ["p"], ["h2"], [".bg-primary"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 15.2pt (20.25px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 3.55 (foreground color: #ffffff, background color: #ea580c, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1

### UX012 · P1 · color-contrast on /tenants

Requested page `/tenants`, final `/tenants`; installation-owner; 390x844. Evidence: screens/installation-owner--tenants--390.png (`screens/installation-owner--tenants--390.png`), record 127 in `pages.json`.
Rule: `color-contrast`. Count: 3. Confidence: automated.
Targets: `[[".mt-2"], ["h2"], ["a"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 1.06 (foreground color: #111111, background color: #111827, font size: 15.2pt (20.25px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 3.55 (foreground color: #ffffff, background color: #ea580c, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1

### UX013 · P1 · Horizontal overflow on /admin

Requested page `/admin`, final `/admin`; installation-owner; 390x844. Evidence: screens/installation-owner--admin--390.png (`screens/installation-owner--admin--390.png`), record 163 in `pages.json`.
Rule: `overflow`. Count: 411. Confidence: automated.
Targets: `null`.

Viewport 390px, document 801px. Offending elements: [{"tag": "BUTTON", "text": "Sign out", "width": 63.359375}]

### UX014 · P1 · Horizontal overflow on /settings/branding

Requested page `/settings/branding`, final `/settings/branding`; installation-owner; 390x844. Evidence: screens/installation-owner--settings-branding--390.png (`screens/installation-owner--settings-branding--390.png`), record 142 in `pages.json`.
Rule: `overflow`. Count: 219. Confidence: automated.
Targets: `null`.

Viewport 390px, document 609px. Offending elements: [{"tag": "INPUT", "text": "", "width": 324}, {"tag": "SELECT", "text": "noneopentenantExample Organisation", "width": 324}, {"tag": "INPUT", "text": "", "width": 324}]

### UX015 · P1 · Horizontal overflow on /settings/modules

Requested page `/settings/modules`, final `/settings/modules`; installation-owner; 390x844. Evidence: screens/installation-owner--settings-modules--390.png (`screens/installation-owner--settings-modules--390.png`), record 157 in `pages.json`.
Rule: `overflow`. Count: 219. Confidence: automated.
Targets: `null`.

Viewport 390px, document 609px. Offending elements: [{"tag": "BUTTON", "text": "Save presentation settings", "width": 137.6875}, {"tag": "INPUT", "text": "", "width": 324}, {"tag": "BUTTON", "text": "Save presentation settings", "width": 137.6875}, {"tag": "INPUT", "text": "", "width": 324}, {"tag": "BUTTON", "text": "Save presentation settings", "width": 137.6875}, {"tag": "INPUT", "text": "", "width": 324}]

### UX016 · P1 · Horizontal overflow on /settings/navigation

Requested page `/settings/navigation`, final `/settings/navigation`; installation-owner; 390x844. Evidence: screens/installation-owner--settings-navigation--390.png (`screens/installation-owner--settings-navigation--390.png`), record 160 in `pages.json`.
Rule: `overflow`. Count: 219. Confidence: automated.
Targets: `null`.

Viewport 390px, document 609px. Offending elements: [{"tag": "SPAN", "text": "assessment.assessment", "width": 199.140625}, {"tag": "INPUT", "text": "", "width": 324}, {"tag": "INPUT", "text": "", "width": 144}, {"tag": "BUTTON", "text": "Save navigation", "width": 119.15625}, {"tag": "SPAN", "text": "brain.workspace", "width": 142.25}, {"tag": "INPUT", "text": "", "width": 324}, {"tag": "INPUT", "text": "", "width": 144}, {"tag": "BUTTON", "text": "Save navigation", "width": 119.15625}, {"tag": "SPAN", "text": "support.tickets", "width": 142.25}, {"tag": "INPUT", "text": "", "width": 324}, {"tag": "INPUT", "text": "", "width": 144}, {"tag": "BUTTON", "text": "Save navigation", "width": 119.15625}]

### UX017 · P1 · Horizontal overflow on /

Requested page `/`, final `/`; installation-owner; 390x844. Evidence: screens/installation-owner--home--390.png (`screens/installation-owner--home--390.png`), record 122 in `pages.json`.
Rule: `overflow`. Count: 175. Confidence: automated.
Targets: `null`.

Viewport 390px, document 565px. Offending elements: [{"tag": "BUTTON", "text": "Sign out", "width": 63.359375}]

### UX018 · P1 · Horizontal overflow on /settings/members

Requested page `/settings/members`, final `/settings/members`; installation-owner; 390x844. Evidence: screens/installation-owner--settings-members--390.png (`screens/installation-owner--settings-members--390.png`), record 154 in `pages.json`.
Rule: `overflow`. Count: 159. Confidence: automated.
Targets: `null`.

Viewport 390px, document 549px. Offending elements: [{"tag": "LABEL", "text": "Email", "width": 288}, {"tag": "SPAN", "text": "Email", "width": 288}, {"tag": "INPUT", "text": "", "width": 288}, {"tag": "TABLE", "text": "NameEmailRoleStatusUAT adminuat-admin@example.testtenant_adminactiveRe", "width": 679.109375}, {"tag": "THEAD", "text": "NameEmailRoleStatus", "width": 679.109375}, {"tag": "TR", "text": "NameEmailRoleStatus", "width": 679.109375}, {"tag": "TH", "text": "Email", "width": 206.6875}, {"tag": "TH", "text": "Role", "width": 162.078125}, {"tag": "TH", "text": "Status", "width": 95.203125}, {"tag": "TH", "text": "", "width": 110.796875}, {"tag": "TBODY", "text": "UAT adminuat-admin@example.testtenant_adminactiveRemoveExample Adminad", "width": 679.109375}, {"tag": "TR", "text": "UAT adminuat-admin@example.testtenant_adminactiveRemove", "width": 679.109375}]

### UX019 · P1 · Horizontal overflow on /settings/connections

Requested page `/settings/connections`, final `/settings/connections`; installation-owner; 390x844. Evidence: screens/installation-owner--settings-connections--390.png (`screens/installation-owner--settings-connections--390.png`), record 145 in `pages.json`.
Rule: `overflow`. Count: 139. Confidence: automated.
Targets: `null`.

Viewport 390px, document 529px. Offending elements: [{"tag": "DIV", "text": "Google WorkspaceGmail, Drive, and Calendar (read-only) feed the brain'", "width": 120.703125}, {"tag": "H2", "text": "Google Workspace", "width": 120.703125}, {"tag": "P", "text": "Gmail, Drive, and Calendar (read-only) feed the brain's memory with pr", "width": 120.703125}, {"tag": "P", "text": "Not connected \u00b7 not configured for this deployment", "width": 120.703125}, {"tag": "P", "text": "Grants: gmail.readonly, drive.readonly, calendar.readonly", "width": 120.703125}, {"tag": "FORM", "text": "Connect", "width": 101.125}, {"tag": "BUTTON", "text": "Connect", "width": 101.125}, {"tag": "DIV", "text": "SlackFlagged channels and threads become searchable, cited memory.Not ", "width": 115.734375}, {"tag": "H2", "text": "Slack", "width": 115.734375}, {"tag": "P", "text": "Flagged channels and threads become searchable, cited memory.", "width": 115.734375}, {"tag": "P", "text": "Not connected \u00b7 not configured for this deployment", "width": 115.734375}, {"tag": "P", "text": "Grants: channels:history, channels:read, users:read", "width": 115.734375}]

### UX020 · P1 · Horizontal overflow on /settings/domains

Requested page `/settings/domains`, final `/settings/domains`; installation-owner; 390x844. Evidence: screens/installation-owner--settings-domains--390.png (`screens/installation-owner--settings-domains--390.png`), record 148 in `pages.json`.
Rule: `overflow`. Count: 125. Confidence: automated.
Targets: `null`.

Viewport 390px, document 515px. Offending elements: [{"tag": "INPUT", "text": "", "width": 245}, {"tag": "BUTTON", "text": "Save metadata", "width": 112.34375}]

### UX021 · P1 · scrollable-region-focusable on /admin/audit

Requested page `/admin/audit`, final `/admin/audit`; installation-owner; 390x844. Evidence: screens/installation-owner--admin-audit--390.png (`screens/installation-owner--admin-audit--390.png`), record 166 in `pages.json`.
Rule: `scrollable-region-focusable`. Count: 1. Confidence: automated.
Targets: `[[".mt-6"]]`.

Fix any of the following:   Element should have focusable content   Element should be focusable

### UX022 · P1 · scrollable-region-focusable on /admin/helpdesk

Requested page `/admin/helpdesk`, final `/admin/helpdesk`; installation-owner; 390x844. Evidence: screens/installation-owner--admin-helpdesk--390.png (`screens/installation-owner--admin-helpdesk--390.png`), record 169 in `pages.json`.
Rule: `scrollable-region-focusable`. Count: 1. Confidence: automated.
Targets: `[[".overflow-x-auto"]]`.

Fix any of the following:   Element should have focusable content   Element should be focusable

### UX023 · P1 · scrollable-region-focusable on /support

Requested page `/support`, final `/support`; tenant-owner; 390x844. Evidence: screens/tenant-owner--support--390.png (`screens/tenant-owner--support--390.png`), record 286 in `pages.json`.
Rule: `scrollable-region-focusable`. Count: 1. Confidence: automated.
Targets: `[[".mt-8"]]`.

Fix any of the following:   Element should have focusable content   Element should be focusable

### UX024 · P1 · color-contrast on /support/acb9aa32-9705-488a-ba72-8106cacfa764

Requested page `/support/acb9aa32-9705-488a-ba72-8106cacfa764`, final `/support/acb9aa32-9705-488a-ba72-8106cacfa764`; installation-owner; 390x844. Evidence: screens/installation-owner--support-acb9aa32-9705-488a-ba72-8106cacfa764--390.png (`screens/installation-owner--support-acb9aa32-9705-488a-ba72-8106cacfa764--390.png`), record 196 in `pages.json`.
Rule: `color-contrast`. Count: 8. Confidence: automated.
Targets: `[["a"], [".font-mono"], ["div:nth-child(1) > dt"], ["div:nth-child(2) > dt"], ["div:nth-child(3) > dt"], [".mb-1"], [".bg-primary"], ["summary"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 3.55 (foreground color: #ffffff, background color: #ea580c, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1

### UX025 · P1 · color-contrast on /settings/members

Requested page `/settings/members`, final `/settings/members`; installation-owner; 390x844. Evidence: screens/installation-owner--settings-members--390.png (`screens/installation-owner--settings-members--390.png`), record 154 in `pages.json`.
Rule: `color-contrast`. Count: 6. Confidence: automated.
Targets: `[[".items-center.gap-3.flex:nth-child(2) > span"], ["p"], ["label:nth-child(2) > .mb-1.font-semibold.uppercase"], ["label:nth-child(3) > .mb-1.font-semibold.uppercase"], [".bg-primary"], ["th:nth-child(1)"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 3.55 (foreground color: #ffffff, background color: #ea580c, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: bold). Expected contrast ratio of 4.5:1

### UX026 · P1 · color-contrast on /admin/support

Requested page `/admin/support`, final `/admin/support`; installation-owner; 390x844. Evidence: screens/installation-owner--admin-support--390.png (`screens/installation-owner--admin-support--390.png`), record 172 in `pages.json`.
Rule: `color-contrast`. Count: 5. Confidence: automated.
Targets: `[[".text-amber-500"], ["p:nth-child(3)"], ["span"], [".bg-primary"], ["a"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.13 (foreground color: #fe9a00, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 3.55 (foreground color: #ffffff, background color: #ea580c, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1

### UX027 · P1 · color-contrast on /admin/helpdesk

Requested page `/admin/helpdesk`, final `/admin/helpdesk`; installation-owner; 390x844. Evidence: screens/installation-owner--admin-helpdesk--390.png (`screens/installation-owner--admin-helpdesk--390.png`), record 169 in `pages.json`.
Rule: `color-contrast`. Count: 4. Confidence: automated.
Targets: `[[".underline-offset-2"], ["main > p"], [".w-fit"], [".text-xs"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 3.55 (foreground color: #ffffff, background color: #ea580c, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1

### UX028 · P1 · color-contrast on /settings/domains

Requested page `/settings/domains`, final `/settings/domains`; installation-owner; 390x844. Evidence: screens/installation-owner--settings-domains--390.png (`screens/installation-owner--settings-domains--390.png`), record 148 in `pages.json`.
Rule: `color-contrast`. Count: 4. Confidence: automated.
Targets: `[[".gap-3.items-center.flex:nth-child(2) > span"], ["main > div > p"], [".text-xs"], [".bg-primary"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 3.55 (foreground color: #ffffff, background color: #ea580c, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1

### UX029 · P1 · color-contrast on /admin/tenants/tenant_e2e/brand-proposals

Requested page `/admin/tenants/tenant_e2e/brand-proposals`, final `/admin/tenants/tenant_e2e/brand-proposals`; installation-owner; 390x844. Evidence: screens/installation-owner--admin-tenants-tenant-e2e-brand-proposals--390.png (`screens/installation-owner--admin-tenants-tenant-e2e-brand-proposals--390.png`), record 181 in `pages.json`.
Rule: `color-contrast`. Count: 3. Confidence: automated.
Targets: `[["span"], [".text-xs"], [".leading-6"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 10.1pt (13.5px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1

### UX030 · P1 · color-contrast on /settings/connections

Requested page `/settings/connections`, final `/settings/connections`; installation-owner; 390x844. Evidence: screens/installation-owner--settings-connections--390.png (`screens/installation-owner--settings-connections--390.png`), record 145 in `pages.json`.
Rule: `color-contrast`. Count: 3. Confidence: automated.
Targets: `[[".gap-3.items-center.flex:nth-child(2) > span"], ["main > div > p"], [".gap-6.rounded-lg.p-4:nth-child(1) > div > p:nth-child(2)"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1

### UX031 · P1 · color-contrast on /settings/identity

Requested page `/settings/identity`, final `/settings/identity`; installation-owner; 390x844. Evidence: screens/installation-owner--settings-identity--390.png (`screens/installation-owner--settings-identity--390.png`), record 151 in `pages.json`.
Rule: `color-contrast`. Count: 2. Confidence: automated.
Targets: `[[".gap-3.items-center.text-sm > span"], ["p"]]`.

Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1; Fix any of the following:   Element has insufficient color contrast of 2.56 (foreground color: #94a3b8, background color: #ffffff, font size: 11.8pt (15.75px), font weight: normal). Expected contrast ratio of 4.5:1

### UX032 · P1 · target-size on /api/auth/better-auth/login

Requested page `/tenants`, final `/api/auth/better-auth/login`; signed-out; 390x844. Evidence: screens/signed-out--tenants--390.png (`screens/signed-out--tenants--390.png`), record 4 in `pages.json`.
Rule: `target-size`. Count: 2. Confidence: automated.
Targets: `[["summary"], ["form[action=\"/api/auth/better-auth/sign-out\"] > button"]]`.

Fix any of the following:   Target has insufficient size (374px by 19px, should be at least 24px by 24px)   Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 19px instead of at least 24px.; Fix any of the following:   Target has insufficient size (69px by 21px, should be at least 24px by 24px)   Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 21px instead of at least 24px.

### UX033 · P2 · Horizontal overflow on /settings

Requested page `/settings`, final `/settings`; installation-owner; 390x844. Evidence: screens/installation-owner--settings--390.png (`screens/installation-owner--settings--390.png`), record 134 in `pages.json`.
Rule: `overflow`. Count: 68. Confidence: automated.
Targets: `null`.

Viewport 390px, document 458px. Offending elements: []

### UX034 · P2 · Horizontal overflow on /assessment

Requested page `/assessment`, final `/assessment`; installation-owner; 390x844. Evidence: screens/installation-owner--assessment--390.png (`screens/installation-owner--assessment--390.png`), record 187 in `pages.json`.
Rule: `overflow`. Count: 28. Confidence: automated.
Targets: `null`.

Viewport 390px, document 418px. Offending elements: [{"tag": "ASIDE", "text": "1Strategy0/5 \u00b7 20%2Business Processes & Governance0/5 \u00b7 20%3Data & Inf", "width": 404.171875}, {"tag": "SECTION", "text": "1Strategy0/5 \u00b7 20%2Business Processes & Governance0/5 \u00b7 20%3Data & Inf", "width": 404.171875}, {"tag": "NAV", "text": "1Strategy0/5 \u00b7 20%2Business Processes & Governance0/5 \u00b7 20%3Data & Inf", "width": 377.171875}, {"tag": "BUTTON", "text": "1Strategy0/5 \u00b7 20%", "width": 377.171875}, {"tag": "BUTTON", "text": "2Business Processes & Governance0/5 \u00b7 20%", "width": 377.171875}, {"tag": "SPAN", "text": "Business Processes & Governance0/5 \u00b7 20%", "width": 346.640625}, {"tag": "SPAN", "text": "Business Processes & Governance", "width": 346.640625}, {"tag": "SPAN", "text": "0/5 \u00b7 20%", "width": 346.640625}, {"tag": "BUTTON", "text": "3Data & Infrastructure0/5 \u00b7 25%", "width": 377.171875}, {"tag": "BUTTON", "text": "4Technology & Tools0/5 \u00b7 20%", "width": 377.171875}, {"tag": "BUTTON", "text": "5Org, Culture & Talent0/5 \u00b7 15%", "width": 377.171875}, {"tag": "DIV", "text": "ManageResponses0 saved \u00b7 consolidation", "width": 377.171875}]

### UX035 · P2 · Horizontal overflow on /settings/activity

Requested page `/settings/activity`, final `/settings/activity`; installation-owner; 390x844. Evidence: screens/installation-owner--settings-activity--390.png (`screens/installation-owner--settings-activity--390.png`), record 139 in `pages.json`.
Rule: `overflow`. Count: 24. Confidence: automated.
Targets: `null`.

Viewport 390px, document 414px. Offending elements: [{"tag": "H2", "text": "Tenant provisioned", "width": 119.1875}]

### UX036 · P2 · Horizontal overflow on /admin/tenants/tenant_e2e

Requested page `/admin/tenants/tenant_e2e`, final `/admin/tenants/tenant_e2e`; installation-owner; 390x844. Evidence: screens/installation-owner--admin-tenants-tenant-e2e--390.png (`screens/installation-owner--admin-tenants-tenant-e2e--390.png`), record 178 in `pages.json`.
Rule: `overflow`. Count: 13. Confidence: automated.
Targets: `null`.

Viewport 390px, document 403px. Offending elements: [{"tag": "TABLE", "text": "JobStatusAttemptsActionowner_grantacae1aa3-cb62-454e-84ed-3f7e17a5d8df", "width": 367.34375}, {"tag": "THEAD", "text": "JobStatusAttemptsAction", "width": 367.34375}, {"tag": "TR", "text": "JobStatusAttemptsAction", "width": 367.34375}, {"tag": "TH", "text": "Action", "width": 64.5625}, {"tag": "TBODY", "text": "owner_grantacae1aa3-cb62-454e-84ed-3f7e17a5d8dfcompleted1/5provision7a", "width": 367.34375}, {"tag": "TR", "text": "owner_grantacae1aa3-cb62-454e-84ed-3f7e17a5d8dfcompleted1/5", "width": 367.34375}, {"tag": "TD", "text": "", "width": 64.5625}, {"tag": "TR", "text": "provision7a9cd706-a230-4c3a-b3a0-5a5d2b7b7cf4completed1/5", "width": 367.34375}, {"tag": "TD", "text": "", "width": 64.5625}]

### UX037 · P2 · Form controls without explicit labels on /assessment

Requested page `/assessment`, final `/assessment`; installation-owner; 390x844. Evidence: screens/installation-owner--assessment--390.png (`screens/installation-owner--assessment--390.png`), record 187 in `pages.json`.
Rule: `visible-label`. Count: 5. Confidence: heuristic: placeholders may still supply an accessible name.
Targets: `null`.

["<input data-slot=\"input\" class=\"platform-ui-control-text h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foregroun", "<input data-slot=\"input\" class=\"platform-ui-control-text h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foregroun", "<input data-slot=\"input\" class=\"platform-ui-control-text h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foregroun", "<input data-slot=\"input\" class=\"platform-ui-control-text h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foregroun", "<input data-slot=\"input\" class=\"platform-ui-control-text h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foregroun"]

### UX038 · P2 · Form controls without explicit labels on /assessment?uatStage=dimensions

Requested page `/assessment?uatStage=dimensions`, final `/assessment`; installation-owner; 390x844. Evidence: screens/installation-owner--assessment-uatStage-dimensions--390.png (`screens/installation-owner--assessment-uatStage-dimensions--390.png`), record 217 in `pages.json`.
Rule: `visible-label`. Count: 5. Confidence: heuristic: placeholders may still supply an accessible name.
Targets: `null`.

["<input data-slot=\"input\" class=\"platform-ui-control-text h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foregroun", "<input data-slot=\"input\" class=\"platform-ui-control-text h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foregroun", "<input data-slot=\"input\" class=\"platform-ui-control-text h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foregroun", "<input data-slot=\"input\" class=\"platform-ui-control-text h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foregroun", "<input data-slot=\"input\" class=\"platform-ui-control-text h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foregroun"]

### UX039 · P2 · Form controls without explicit labels on /assessment?uatStage=results

Requested page `/assessment?uatStage=results`, final `/assessment`; installation-owner; 390x844. Evidence: screens/installation-owner--assessment-uatStage-results--390.png (`screens/installation-owner--assessment-uatStage-results--390.png`), record 220 in `pages.json`.
Rule: `visible-label`. Count: 5. Confidence: heuristic: placeholders may still supply an accessible name.
Targets: `null`.

["<input data-slot=\"input\" class=\"platform-ui-control-text h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foregroun", "<input data-slot=\"input\" class=\"platform-ui-control-text h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foregroun", "<input data-slot=\"input\" class=\"platform-ui-control-text h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foregroun", "<input data-slot=\"input\" class=\"platform-ui-control-text h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foregroun", "<input data-slot=\"input\" class=\"platform-ui-control-text h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foregroun"]

### UX040 · P2 · Potential missing keyboard focus indicator on /assessment?uatStage=results

Requested page `/assessment?uatStage=results`, final `/assessment`; installation-owner; 390x844. Evidence: screens/installation-owner--assessment-uatStage-results--390.png (`screens/installation-owner--assessment-uatStage-results--390.png`), record 220 in `pages.json`.
Rule: `focus`. Count: 1. Confidence: heuristic; inspect outlines, border/background changes and pseudo-elements manually.
Targets: `null`.

[{"index": 20, "tag": "BUTTON", "text": " Back to assessment", "html": "<button data-slot=\"button\" data-variant=\"default\" data-size=\"sm\" class=\"platform-ui-control-text inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors outline-none focus-visible", "focused": true, "visible": true, "outline": false, "shadow": "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.646079 0.146426 0.127797 / 0.5) 0px 0px 0px 3px, rgba(0, 0, 0, 0) 0px 0px 0px 0px", "border": "rgb(30, 42, 63)", "background": "rgb(234, 88, 12)", "base": {"shadow": "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.646079 0.146426 0.127797 / 0.5) 0px 0px 0px 3px, rgba(0, 0, 0, 0) 0px 0px 0px 0px", "border": "rgb(30, 42, 63)", "background": "rgb(234, 88, 12)", "color": "rgb(17, 24, 39)"}}]

### UX041 · P2 · Browser error on /m/e2e-stub/

Requested page `/m/e2e-stub/`, final `/m/e2e-stub`; installation-owner; 390x844. Evidence: screens/installation-owner--m-e2e-stub--390.png (`screens/installation-owner--m-e2e-stub--390.png`), record 205 in `pages.json`.
Rule: `console`. Count: 1. Confidence: automated.
Targets: `null`.

[{"type": "uncaught", "text": "SecurityError: Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag."}]

### UX042 · P2 · Potential missing keyboard focus indicator on /support/acb9aa32-9705-488a-ba72-8106cacfa764

Requested page `/support/acb9aa32-9705-488a-ba72-8106cacfa764`, final `/support/acb9aa32-9705-488a-ba72-8106cacfa764`; installation-owner; 390x844. Evidence: screens/installation-owner--support-acb9aa32-9705-488a-ba72-8106cacfa764--390.png (`screens/installation-owner--support-acb9aa32-9705-488a-ba72-8106cacfa764--390.png`), record 196 in `pages.json`.
Rule: `focus`. Count: 1. Confidence: heuristic; inspect outlines, border/background changes and pseudo-elements manually.
Targets: `null`.

[{"index": 0, "tag": "A", "text": "\u2190 Support", "html": "<a class=\"text-sm text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2\" href=\"/support\">\u2190 Support</a>", "focused": true, "visible": true, "outline": false, "shadow": "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(255, 255, 255) 0px 0px 0px 2px, rgb(234, 88, 12) 0px 0px 0px 4px, rgba(0, 0, 0, 0) 0px 0px 0px 0px", "border": "rgb(30, 42, 63)", "background": "rgba(0, 0, 0, 0)", "base": {"shadow": "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(255, 255, 255) 0px 0px 0px 2px, rgb(234, 88, 12) 0px 0px 0px 4px, rgba(0, 0, 0, 0) 0px 0px 0px 0px", "border": "rgb(30, 42, 63)", "background": "rgba(0, 0, 0, 0)", "color": "rgb(148, 163, 184)"}}]

### UX043 · P2 · Missing h1 on /

Requested page `/`, final `/`; signed-out; 390x844. Evidence: screens/signed-out--home--390.png (`screens/signed-out--home--390.png`), record 1 in `pages.json`.
Rule: `h1`. Count: None. Confidence: automated.
Targets: `null`.

No h1 found. This is a document-structure diagnostic, not automatically an axe WCAG failure.

### UX044 · P2 · Missing h1 on /assessment

Requested page `/assessment`, final `/assessment`; tenant-owner; 390x844. Evidence: screens/tenant-owner--assessment--390.png (`screens/tenant-owner--assessment--390.png`), record 280 in `pages.json`.
Rule: `h1`. Count: None. Confidence: automated.
Targets: `null`.

No h1 found. This is a document-structure diagnostic, not automatically an axe WCAG failure.

### UX045 · P2 · Missing page title

Requested page `/m/e2e-stub/`, final `/m/e2e-stub`; installation-owner; 390x844. Evidence: screens/installation-owner--m-e2e-stub--390.png (`screens/installation-owner--m-e2e-stub--390.png`), record 205 in `pages.json`.
Rule: `title`. Count: None. Confidence: automated.
Targets: `null`.

document.title is empty

### UX046 · P2 · Missing h1 on /settings/activity

Requested page `/settings/activity`, final `/settings/activity`; managed-support; 390x844. Evidence: screens/managed-support--settings-activity--390.png (`screens/managed-support--settings-activity--390.png`), record 513 in `pages.json`.
Rule: `h1`. Count: None. Confidence: automated.
Targets: `null`.

No h1 found. This is a document-structure diagnostic, not automatically an axe WCAG failure.

### UX047 · P2 · Missing h1 on /settings/identity

Requested page `/settings/identity`, final `/settings/identity`; managed-support; 390x844. Evidence: screens/managed-support--settings-identity--390.png (`screens/managed-support--settings-identity--390.png`), record 544 in `pages.json`.
Rule: `h1`. Count: None. Confidence: automated.
Targets: `null`.

No h1 found. This is a document-structure diagnostic, not automatically an axe WCAG failure.

### UX048 · P2 · Missing h1 on /settings/members

Requested page `/settings/members`, final `/settings/members`; managed-support; 390x844. Evidence: screens/managed-support--settings-members--390.png (`screens/managed-support--settings-members--390.png`), record 552 in `pages.json`.
Rule: `h1`. Count: None. Confidence: automated.
Targets: `null`.

No h1 found. This is a document-structure diagnostic, not automatically an axe WCAG failure.

### UX049 · P3 · document-title on /api/mcp/developer/authorize

Requested page `/api/mcp/developer/authorize?project_id=cccccccccccccccccccccccccccccccc&client_id=browser-example&redirect_uri=http%3A%2F%2F127.0.0.1%3A3123%2Fcallback&resource=http%3A%2F%2Flocalhost%3A42215%2Fapi%2Fmcp%2Fdeveloper&response_type=code&state=uat-audit&code_challenge_method=S256&code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, final `/api/mcp/developer/authorize`; signed-out; 390x844. Evidence: screens/signed-out--api-mcp-developer-authorize--390.png (`screens/signed-out--api-mcp-developer-authorize--390.png`), record 517 in `pages.json`.
Rule: `document-title`. Count: 1. Confidence: automated.
Targets: `[["html"]]`.

Fix any of the following:   Document does not have a non-empty <title> element

### UX050 · P3 · html-has-lang on /api/mcp/developer/authorize

Requested page `/api/mcp/developer/authorize?project_id=cccccccccccccccccccccccccccccccc&client_id=browser-example&redirect_uri=http%3A%2F%2F127.0.0.1%3A3123%2Fcallback&resource=http%3A%2F%2Flocalhost%3A42215%2Fapi%2Fmcp%2Fdeveloper&response_type=code&state=uat-audit&code_challenge_method=S256&code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, final `/api/mcp/developer/authorize`; signed-out; 390x844. Evidence: screens/signed-out--api-mcp-developer-authorize--390.png (`screens/signed-out--api-mcp-developer-authorize--390.png`), record 517 in `pages.json`.
Rule: `html-has-lang`. Count: 1. Confidence: automated.
Targets: `[["html"]]`.

Fix any of the following:   The <html> element does not have a lang attribute

### UX051 · P3 · document-title on /api/mcp/developer/confirm

Requested page `/api/mcp/developer/confirm`, final `/api/mcp/developer/confirm`; signed-out; 390x844. Evidence: screens/signed-out--api-mcp-developer-confirm--390.png (`screens/signed-out--api-mcp-developer-confirm--390.png`), record 514 in `pages.json`.
Rule: `document-title`. Count: 1. Confidence: automated.
Targets: `[["html"]]`.

Fix any of the following:   Document does not have a non-empty <title> element

### UX052 · P3 · html-has-lang on /api/mcp/developer/confirm

Requested page `/api/mcp/developer/confirm`, final `/api/mcp/developer/confirm`; signed-out; 390x844. Evidence: screens/signed-out--api-mcp-developer-confirm--390.png (`screens/signed-out--api-mcp-developer-confirm--390.png`), record 514 in `pages.json`.
Rule: `html-has-lang`. Count: 1. Confidence: automated.
Targets: `[["html"]]`.

Fix any of the following:   The <html> element does not have a lang attribute

### UX053 · P3 · document-title on /m/e2e-stub/

Requested page `/m/e2e-stub/`, final `/m/e2e-stub`; installation-owner; 390x844. Evidence: screens/installation-owner--m-e2e-stub--390.png (`screens/installation-owner--m-e2e-stub--390.png`), record 205 in `pages.json`.
Rule: `document-title`. Count: 1. Confidence: automated.
Targets: `[["html"]]`.

Fix any of the following:   Document does not have a non-empty <title> element

### UX054 · P3 · html-has-lang on /m/e2e-stub/

Requested page `/m/e2e-stub/`, final `/m/e2e-stub`; installation-owner; 390x844. Evidence: screens/installation-owner--m-e2e-stub--390.png (`screens/installation-owner--m-e2e-stub--390.png`), record 205 in `pages.json`.
Rule: `html-has-lang`. Count: 1. Confidence: automated.
Targets: `[["html"]]`.

Fix any of the following:   The <html> element does not have a lang attribute

### UX055 · P3 · document-title on /m/e2e-stub

Requested page `/m/e2e-stub/`, final `/m/e2e-stub`; tenant-owner; 390x844. Evidence: screens/tenant-owner--m-e2e-stub--390.png (`screens/tenant-owner--m-e2e-stub--390.png`), record 298 in `pages.json`.
Rule: `document-title`. Count: 1. Confidence: automated.
Targets: `[["html"]]`.

Fix any of the following:   Document does not have a non-empty <title> element

### UX056 · P3 · html-has-lang on /m/e2e-stub

Requested page `/m/e2e-stub/`, final `/m/e2e-stub`; tenant-owner; 390x844. Evidence: screens/tenant-owner--m-e2e-stub--390.png (`screens/tenant-owner--m-e2e-stub--390.png`), record 298 in `pages.json`.
Rule: `html-has-lang`. Count: 1. Confidence: automated.
Targets: `[["html"]]`.

Fix any of the following:   The <html> element does not have a lang attribute

### UX057 · P3 · html-has-lang on /support/acb9aa32-9705-488a-ba72-8106cacfa764

Requested page `/support/acb9aa32-9705-488a-ba72-8106cacfa764`, final `/support/acb9aa32-9705-488a-ba72-8106cacfa764`; tenant-owner; 768x1024. Evidence: screens/tenant-owner--support-acb9aa32-9705-488a-ba72-8106cacfa764--768.png (`screens/tenant-owner--support-acb9aa32-9705-488a-ba72-8106cacfa764--768.png`), record 290 in `pages.json`.
Rule: `html-has-lang`. Count: 1. Confidence: automated.
Targets: `[["#__next_error__"]]`.

Fix any of the following:   The <html> element does not have a lang attribute

## Keyboard-only journeys

Navigation to each form uses a URL. Data entry and submission use Tab, typing, Space/arrow keys as applicable, and Enter; no click/fill/selectOption is used for those form operations. DNS challenge publication uses the local harness API, while add/verify controls remain keyboard-operated.

```json
[
  {
    "name": "sign-in",
    "status": "passed",
    "detail": "Authenticated via email/password using Tab and Enter",
    "url": "/"
  },
  {
    "name": "branding",
    "status": "passed",
    "detail": "Submitted branding and retained value",
    "url": "/settings/branding"
  },
  {
    "name": "members",
    "status": "passed",
    "detail": "Invitation appears in member table",
    "url": "/settings/members"
  },
  {
    "name": "support-ticket",
    "status": "passed",
    "detail": "Created ticket /support/aa482c0f-7e25-40e8-84c0-82b25fe92fc1",
    "url": "/support/aa482c0f-7e25-40e8-84c0-82b25fe92fc1"
  },
  {
    "name": "custom-domain",
    "status": "passed",
    "detail": "Added and verified custom domain with local DNS stub, using keyboard controls",
    "url": "/settings/domains"
  },
  {
    "name": "Assessment",
    "status": "passed",
    "detail": "Scored all dimensions and saved response using Tab, Space and Enter",
    "url": "/assessment"
  }
]
```

Local identity also passed a separate three-viewport signed-out/owner smoke, six views, with zero skipped tests. local-identity-results.json and local-playwright-results.json retain the evidence. branding-persistence-recheck.json proves a changed branding value persisted after reload and was restored, using only the keyboard.

Initial sign-in locator ambiguity and a custom-domain request on the fixture-disallowed localhost host were corrected and rerun. `form-rechecks.json` records the independently rerun successful sign-in and Alpha domain flows; failure attempts remain in separate files. They are not classified as product failures.

## Every app page and API/route handler

“Reached” requires a successful page content load or observed successful request. A GET 405, auth denial, disabled adapter or configuration failure is recorded as not reached with a reason. “Probed” is reported separately; a probe is not complete behavioral coverage. File inventory includes all 24 page files and 40 route-handler files under apps/platform/app. Catch-all dispatch also covers native Assessment, Brain and Support pages/APIs. No destructive tenant lifecycle operation or external OAuth exchange was invented merely to turn a coverage cell green.

| File | Route | Reached | Observed statuses | Reason |
|---|---|---|---|---|
| apps/platform/app/.well-known/oauth-authorization-server/route.ts | /well-known/oauth-authorization-server | no | [404] | No successful authorized response. Observed statuses: [404]. Seed, entitlement, authentication, method or configuration gate; see requests.json. |
| apps/platform/app/.well-known/oauth-protected-resource/api/mcp/developer/route.ts | /well-known/oauth-protected-resource/api/mcp/developer | no | [404] | No successful authorized response. Observed statuses: [404]. Seed, entitlement, authentication, method or configuration gate; see requests.json. |
| apps/platform/app/[...modulePath]/page.tsx | /[...modulePath] | yes | [200, 307, 404] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/access/[module]/page.tsx | /access/[module] | yes | [200, 404] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/admin/audit/page.tsx | /admin/audit | yes | [200, 307] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/admin/helpdesk/[tenantId]/[ticketNumber]/page.tsx | /admin/helpdesk/[tenantId]/[ticketNumber] | no | [307] | Harness installation-owner profile omits explicit owner.support.customer_data.read. Routine managed support does not grant it; denied in every tested persona. |
| apps/platform/app/admin/helpdesk/page.tsx | /admin/helpdesk | yes | [200, 307] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/admin/page.tsx | /admin | yes | [200, 307] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/admin/support/page.tsx | /admin/support | yes | [200, 307] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/admin/tenants/[tenantId]/brand-proposals/page.tsx | /admin/tenants/[tenantId]/brand-proposals | yes | [200, 307] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/admin/tenants/[tenantId]/owner-claim/page.tsx | /admin/tenants/[tenantId]/owner-claim | yes | [200] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/admin/tenants/[tenantId]/page.tsx | /admin/tenants/[tenantId] | yes | [200, 404] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/admin/tenants/new/page.tsx | /admin/tenants/new | yes | [200, 307] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/api/[...moduleApi]/route.ts | /api/[...moduleApi] | yes | [303, 405] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/api/admin/brand-proposals/route.ts | /api/admin/brand-proposals | no | [405] | GET probe returns 405; required POST/DELETE mutation not exercised in this read-focused audit. |
| apps/platform/app/api/admin/support-policy/route.ts | /api/admin/support-policy | no | [405] | GET probe returns 405; required POST/DELETE mutation not exercised in this read-focused audit. |
| apps/platform/app/api/admin/support-sessions/exit/route.ts | /api/admin/support-sessions/exit | no | [405] | GET probe returns 405; required POST/DELETE mutation not exercised in this read-focused audit. |
| apps/platform/app/api/admin/support-sessions/route.ts | /api/admin/support-sessions | yes | [405] | POST start exercised and its real managed-support banner asserted; GET probe is 405. See audit.spec.ts and successful playwright-results.json. |
| apps/platform/app/api/admin/tenants/[tenantId]/exports/[archiveId]/route.ts | /api/admin/tenants/[tenantId]/exports/[archiveId] | no | [404] | No successful authorized response. Observed statuses: [404]. Seed, entitlement, authentication, method or configuration gate; see requests.json. |
| apps/platform/app/api/admin/tenants/[tenantId]/jobs/[jobId]/route.ts | /api/admin/tenants/[tenantId]/jobs/[jobId] | no | [404] | No successful authorized response. Observed statuses: [404]. Seed, entitlement, authentication, method or configuration gate; see requests.json. |
| apps/platform/app/api/admin/tenants/[tenantId]/lifecycle/route.ts | /api/admin/tenants/[tenantId]/lifecycle | no | [405] | GET probe returns 405; required POST/DELETE mutation not exercised in this read-focused audit. |
| apps/platform/app/api/admin/tenants/[tenantId]/owner-claim/route.ts | /api/admin/tenants/[tenantId]/owner-claim | no | [405] | GET probe returns 405; required POST/DELETE mutation not exercised in this read-focused audit. |
| apps/platform/app/api/admin/tenants/route.ts | /api/admin/tenants | no | [405] | GET probe returns 405; required POST/DELETE mutation not exercised in this read-focused audit. |
| apps/platform/app/api/auth/better-auth/[...all]/route.ts | /api/auth/better-auth/[...all] | yes | [200] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/api/health/route.ts | /api/health | yes | [200] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/api/mcp/developer/authorize/route.ts | /api/mcp/developer/authorize | yes | [200, 403] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/api/mcp/developer/confirm/route.ts | /api/mcp/developer/confirm | yes | [200, 403] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/api/mcp/developer/preview/route.ts | /api/mcp/developer/preview | no | [405] | GET probe returns 405; required POST/DELETE mutation not exercised in this read-focused audit. |
| apps/platform/app/api/mcp/developer/route.ts | /api/mcp/developer | no | [405] | GET probe returns 405; required POST/DELETE mutation not exercised in this read-focused audit. |
| apps/platform/app/api/mcp/developer/token/route.ts | /api/mcp/developer/token | no | [405] | GET probe returns 405; required POST/DELETE mutation not exercised in this read-focused audit. |
| apps/platform/app/api/module-access/[module]/route.ts | /api/module-access/[module] | no | [405] | GET probe returns 405; required POST/DELETE mutation not exercised in this read-focused audit. |
| apps/platform/app/api/module-broker/[module]/support/tickets/route.ts | /api/module-broker/[module]/support/tickets | no | [405] | GET probe returns 405; required POST/DELETE mutation not exercised in this read-focused audit. |
| apps/platform/app/api/ready/route.ts | /api/ready | yes | [200] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/api/settings/branding/route.ts | /api/settings/branding | yes | [303, 405] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/api/settings/connections/[provider]/callback/route.ts | /api/settings/connections/[provider]/callback | no | [] | OAuth provider/account is unconfigured; exact route probed without following external redirects. No live flow authorized. |
| apps/platform/app/api/settings/connections/[provider]/disconnect/route.ts | /api/settings/connections/[provider]/disconnect | no | [405] | OAuth provider/account is unconfigured; exact route probed without following external redirects. No live flow authorized. |
| apps/platform/app/api/settings/connections/[provider]/start/route.ts | /api/settings/connections/[provider]/start | no | [405] | OAuth provider/account is unconfigured; exact route probed without following external redirects. No live flow authorized. |
| apps/platform/app/api/settings/domains/auth/route.ts | /api/settings/domains/auth | no | [404] | No successful authorized response. Observed statuses: [404]. Seed, entitlement, authentication, method or configuration gate; see requests.json. |
| apps/platform/app/api/settings/domains/route.ts | /api/settings/domains | yes | [200, 405] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/api/settings/identity-portal/route.ts | /api/settings/identity-portal | no | [405] | GET probe returns 405; required POST/DELETE mutation not exercised in this read-focused audit. |
| apps/platform/app/api/settings/members/route.ts | /api/settings/members | yes | [303, 405] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/api/settings/module-access/route.ts | /api/settings/module-access | no | [405] | GET probe returns 405; required POST/DELETE mutation not exercised in this read-focused audit. |
| apps/platform/app/api/settings/navigation/route.ts | /api/settings/navigation | no | [405] | GET probe returns 405; required POST/DELETE mutation not exercised in this read-focused audit. |
| apps/platform/app/api/settings/routine-configuration/route.ts | /api/settings/routine-configuration | no | [405] | GET probe returns 405; required POST/DELETE mutation not exercised in this read-focused audit. |
| apps/platform/app/api/telemetry/route.ts | /api/telemetry | yes | [200, 405] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/auth/callback/route.ts | /auth/callback | no | [404] | No hosted WorkOS OAuth callback is available in the fixture; invalid local callback denied. |
| apps/platform/app/auth/local/route.ts | /auth/local | yes | [302, 404] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/auth/login/route.ts | /auth/login | yes | [302] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/auth/logout/route.ts | /auth/logout | no | [404] | No successful authorized response. Observed statuses: [404]. Seed, entitlement, authentication, method or configuration gate; see requests.json. |
| apps/platform/app/dev/tenant/route.ts | /dev/tenant | no | [400] | No successful authorized response. Observed statuses: [400]. Seed, entitlement, authentication, method or configuration gate; see requests.json. |
| apps/platform/app/m/[module]/[[...path]]/route.ts | /m/[module]/[[...path]] | yes | [200, 308, 404] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/page.tsx | / | yes | [200] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/settings/activity/page.tsx | /settings/activity | yes | [200, 307] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/settings/branding/page.tsx | /settings/branding | yes | [200, 307] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/settings/connections/page.tsx | /settings/connections | yes | [200, 307] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/settings/domains/page.tsx | /settings/domains | yes | [200, 307] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/settings/identity/page.tsx | /settings/identity | yes | [200, 307] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/settings/members/page.tsx | /settings/members | yes | [200, 307] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/settings/modules/page.tsx | /settings/modules | yes | [200, 307] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/settings/navigation/page.tsx | /settings/navigation | yes | [200, 307] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/settings/page.tsx | /settings | yes | [200, 307] | Successful content load or observed request; not all methods/states exercised. |
| apps/platform/app/sign-in/[[...sign-in]]/page.tsx | /sign-in/[[...sign-in]] | no | [404] | Clerk-only UI returns 404 under the local/Better Auth fixture; hosted identity contact forbidden. |
| apps/platform/app/sign-up/[[...sign-up]]/page.tsx | /sign-up/[[...sign-up]] | no | [404] | Clerk-only UI returns 404 under the local/Better Auth fixture; hosted identity contact forbidden. |
| apps/platform/app/tenants/page.tsx | /tenants | yes | [200] | Successful content load or observed request; not all methods/states exercised. |

## Reproduce

```sh
pnpm install --frozen-lockfile --ignore-scripts --offline
pnpm turbo build --filter='./packages/*' --filter='./modules/*' --filter='./examples/*' --filter=@opentenant/migrations --filter=@opentenant/provisioning
npm install --prefix .uat-audit --ignore-scripts --registry=https://registry.npmjs.org
python3 .uat-audit/link-platform-deps.py
forge-job run opentenant-uat-browser -- node .uat-audit/run.mjs
# While that owned server is running, supplemental passcode/helpdesk matrix:
forge-job run opentenant-uat-extra-matrix -- node .uat-audit/extra-matrix.mjs
python3 .uat-audit/report.py
```

To run fresh rather than resume, archive `pages.jsonl` and the previous screenshots within `.uat-audit/`. Generated output and scratch dependencies are disposable. Preserve the wrapper/package symlinks or recreate them from apps/platform/node_modules when moving this directory to another checkout. Stop the printed forge-job units in cleanup and verify the exact run-owned container names are gone. Never stop unrelated host containers.

## Final verification and cleanup

Both audit collection and local-identity smoke collectors completed with one test passed each, zero failed and zero skipped in their final runs. This means evidence collection and the explicit journey assertions completed; it does not mean axe violations passed. All six keyboard journeys passed, and the separate branding persistence recheck passed after reload and restoration.
All 630 matrix cells have complete focus coverage. The six local-identity home views are separate smoke evidence. Mailpit read-back returned HTTP 200 with nine local messages.
cleanup.json verifies every recorded audit unit inactive, seven recorded containers removed, fifteen known listener ports closed, and no tracked changes. forge-job-final-audit.json reports no unmanaged development servers. Existing containers/services belonging to other work were preserved.
Local source verification: the R11 index check passed 20 tests. Production npm audit found no high/critical advisories, with one low and five moderate. Gitleaks found zero source leaks. Semgrep ran seven local rules with zero findings and eight analysis/parsing warnings, so its coverage is partial. Cached offline Trivy reported no high/critical findings. No pre-commit or Promptfoo configuration was present. These bounded checks do not constitute a full security audit.
