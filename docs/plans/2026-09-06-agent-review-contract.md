# Agent assignments and review contract

Date: 2026-09-06. Applies to the [implementation program](2026-09-06-implementation-program.md).

## Dispatch

Use the host's explicit subagent model selection. The requested identifiers are
`gpt-5.6-sol`, `gpt-5.6-luna` and `gpt-6-astra`, each with effort `high`.
Record the actual model and effort returned by the host. If unavailable, report
that limitation before substituting another model. Do not edit application
model policy or rely on ambient CLI defaults to satisfy this assignment.

Keep no more than two implementation workers active by default. Their owned
paths must be disjoint. Start one fresh Astra reviewer after the milestone's
deterministic checks pass. A reviewer may work alongside unrelated implementation,
but its candidate revision must remain fixed.

The coordinating agent owns backlog state, evidence integration, shared docs,
Graphify, commits and authorized remote actions. A worker's successful response
does not itself promote a task to completed.

## Worker prompt template

Fill the task ID, candidate worktree and source revision from the current ledger.
Do not send the entire repository history to each worker.

```text
Implement exactly TASK_ID from docs/plans/2026-09-06-implementation-packets.md.
Use MODEL_ID with reasoning effort high. Worktree: TASK_WORKTREE.
Expected base revision: BASE_SHA.

Read AGENTS.md, RTK.md, docs/HANDOFF.md, docs/OWNER-TASKS.md, this packet,
the accepted source requirement and the named files. Query Graphify for scoped
navigation; confirm details in source. Apply unslop to authored prose.

Own only the packet's paths. Verify the base revision and preserve unrelated work.
Write the focused regression check for the reported behavior, implement the
bounded change, and run the packet's checks. Use only synthetic local data and
injected provider adapters. Do not inspect secret-bearing files.

Do not change shared backlog or completion records, stage/commit, publish,
push/merge, deploy, activate Developer MCP, contact people or call live providers.
The coordinator handles those actions when authorized. Do not weaken existing
verification or change acceptance criteria to make the work pass.

Return: requirement/finding IDs; changed paths; actual commands and results;
tests executed/skipped; artifact/browser evidence where required; remaining
uncertainty; and a concise diff explanation. If the packet cannot represent the
accepted policy, report the exact conflict without inventing authority.
```

Sol packets require cross-package reasoning and explicit transaction/policy
contracts. Luna packets should fit one bounded workflow. Escalate a Luna packet
to Sol when implementing it would change authorization, schema ownership or a
shared interface that the packet did not settle. That is a coordination change,
not a reason to ask the owner to approve routine local code.

## Astra review prompt template

```text
Review MILESTONE_ID at CANDIDATE_SHA using gpt-6-astra, reasoning effort high.
This is a fresh read-only review. Read the accepted requirements, task packets,
review evidence and actual diff. Do not trust the implementation summary alone.

Deterministic checks have completed; inspect their command, revision, result and
skip counts. Confirm every requested outcome has evidence. Identify concrete
correctness, tenant binding, attribution, data preservation, interface or user
journey failures. Cite exact source locations and the unmet requirement.

Do not execute exploit reproductions, contact providers or alter files. Review
the authorization and defensive behavior from source and existing safe checks.

Return ACCEPT or CHANGES_REQUIRED, with numbered findings, severity, source,
expected behavior, evidence and required correction. Separate external blockers
from code findings. State what was not reviewed. Passing tests alone do not prove
deployment, real data isolation, provider capability or UI fidelity.
```

## Review sequence

1. G0 reviews requirement coverage, task size, dependencies, model division and
   the owner boundary. Fix ambiguous acceptance criteria before code starts.
2. M1 reviews corrected access, telemetry records, respondent edits, production
   fallback, dependency audits and database-store execution.
3. M2 reviews the assembled user journeys. Require browser/download evidence and
   durable policy/audit readback where the task claims persistence.
4. M3 reviews each design against its accepted PRD and lists the code work still
   needed. Design completion must not become product completion.
5. GFinal checks the integrated diff, all task outcomes and any open findings.
   Report readiness for the requested local scope separately from release gates.

The coordinator checks every review finding against source before changing code.
After a correction, rerun affected checks and obtain one fresh review of that
relevant revision. Use another reviewer only for a distinct unresolved risk.
Do not rerun full checks or request redundant reviews without a reason.

## Evidence record

Use this structure for each executed task; actual values must replace the labels.

```text
Task / requirement / finding:
Base SHA / candidate SHA:
Actual worker model and effort:
Owned paths and diff:
Focused behavior evidence:
Repository checks with exit codes and cache status:
Database tests executed / skipped:
Browser journey and artifact references:
Reviewer model / revision / decision:
Findings verified, fixed or rejected with reason:
Remaining external dependency and responsible owner:
Marketing impact:
Status: planned | implementing | not_verified | accepted | blocked
```

This status vocabulary belongs to the coordination evidence. Map it deliberately
to the current backlog schema; do not add new controller enum values implicitly.

## Planning review record

The initial source review used Sol high for requirement traceability, Luna high
for module/quality review and Astra high for architecture review. The primary
agent verified the findings and corrected unsupported or overstated claims.
Fresh Node 22 quality/build checks passed; dependency audits failed as recorded
in the source review. Database and browser evidence remain unverified in this
planning-only task.

The first fresh final Astra high review returned CHANGES_REQUIRED on two packet
ownership gaps. OT-I03 now owns the typed brand provenance read model and its
database-backed verification. OT-I05 now owns ResultsScreen/readout persistence,
restoration without automatic regeneration, stale-input handling and behavior
tests. The primary reviewer verified both findings in source before applying
these corrections. A fresh Astra high reviewer then returned ACCEPT for the
corrected final planning scope, with no remaining issues. This acceptance covers
the planning documents, not application implementation or production readiness.

## Execution review record

The local program followed the assigned Sol/Luna implementation split and used
fresh Astra reviews at contract, task, milestone and correction boundaries.
M1 is accepted in `docs/reviews/2026-09-06-m1.md`. M2 was originally accepted
at `7e7f89b` after 179 Assessment tests, 321 platform tests, a 63-task uncached
repository matrix, a forced platform build, PostgreSQL readback and BrowserOS
journeys. GFinal later invalidated the narrow OT-I03 supersede-authorization
point. Commit `479cba6` corrected it, and fresh review accepted `cba0632`.

Each M3 contract was corrected and accepted independently. The durable records
are `docs/reviews/2026-09-06-ot-d01.md`, `2026-09-06-ot-d02.md` and
`2026-09-06-ot-d03.md`. Their acceptance is design completion only. Developer
MCP exposure, Support AI implementation and Quality Contract persistence remain
future work behind the dependencies stated in those contracts.

The integrated M3 reviewer returned three delivery-contract corrections at
`4486f34`. A fresh Astra review accepted `2bc70c7` after migration allocation,
database-CI ownership and the 22-workspace quality matrix were made explicit.
The final gate therefore required another fresh reviewer at the exact
reconciled program revision after deterministic checks passed.

The first GFinal review at `26fdbdb` found one brand supersede-authorization
defect and two current-document truthfulness issues. After red/green correction,
fresh deterministic checks and PostgreSQL evidence, a new Astra reviewer
accepted exact revision `cba0632` with no remaining P1 or P2 finding.
