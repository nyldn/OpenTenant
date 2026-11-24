# Unattended development

OpenTenant has a local-first unattended runner for safe, already-specified
repository work. It selects one dependency-ready task from a versioned backlog,
gives that task to a fresh ephemeral Codex session, and independently requires a
`not_verified` ledger transition, clean worktree, declared path scope, and
deterministic verification. The controller, not the agent, creates the task and
completion commits.

The runner is not a release bot. It cannot authorize owner decisions and is not
allowed to push, merge, deploy, publish, call provider APIs, read `.env`, use
genuine tenant data, or perform destructive Git operations.

## Research basis

Star counts are a live GitHub API snapshot from 2026-07-21. Popularity is only a
discovery signal; it is not a security or quality guarantee.

| Project | Stars | Licence | Useful pattern |
|---|---:|---|---|
| [OpenAI Codex](https://github.com/openai/codex) | 100,381 | Apache-2.0 | Non-interactive execution, sandbox selection, ephemeral/resumable sessions, structured output |
| [OpenHands](https://github.com/OpenHands/OpenHands) | 81,576 | MIT outside `enterprise/`; PolyForm Free Trial 1.0.0 inside it | Event-log persistence, pause/resume, isolated sandboxes, headless automation |
| [Cline](https://github.com/cline/cline) | 64,901 | Apache-2.0 | Worktree-per-task orchestration, dependency chains, checkpoints, headless execution |
| [Aider](https://github.com/Aider-AI/aider) | 47,587 | Apache-2.0 | Git checkpoints, dirty-file preservation, automatic lint/test repair loops |
| [Ralph](https://github.com/snarktank/ralph) | 21,195 | MIT | One story per fresh context, JSON backlog, append-only progress, bounded iterations |
| [SWE-agent](https://github.com/SWE-agent/SWE-agent) | 19,878 | MIT | Per-task containers, reproducible trajectories, batch workers, skip-completed behavior |
| [Plandex](https://github.com/plandex-ai/plandex) | 15,540 | MIT | Pending-change sandbox, plan history, rewind, configurable autonomy and bounded repair |
| [Open SWE](https://github.com/langchain-ai/open-swe) | 10,377 | MIT | Persistent task sandboxes, parallel work, trigger adapters and credential proxying |
| [Claude Code Action](https://github.com/anthropics/claude-code-action) | 8,415 | MIT | Trusted-trigger checks, allowlisted tools, short-lived tokens and progress reporting |
| [GitHub Agentic Workflows](https://github.com/github/gh-aw) | 4,788 | MIT; Public Preview | Read-only agent runtime, network firewall, budgets, compiled lockfiles, threat detection and separately applied safe outputs |

Primary implementation references include GitHub's documentation for
[Agentic Workflow architecture](https://github.github.com/gh-aw/introduction/architecture/),
[permissions](https://github.github.com/gh-aw/reference/permissions/),
[network controls](https://github.github.com/gh-aw/reference/network/), and
[safe outputs](https://github.github.com/gh-aw/reference/safe-outputs/), plus
[SWE-agent trajectories](https://github.com/SWE-agent/SWE-agent/blob/main/docs/usage/trajectories.md).

No source code, prompts, workflow files, or assets from these projects were
copied or vendored. The implementation is original OpenTenant code using Node
built-ins, so the research added no runtime dependency or third-party licence
obligation. OpenHands' mixed licence is recorded explicitly because GitHub's
single SPDX field does not describe its `enterprise/` subtree.

## Patterns adopted

1. **One task per fresh context.** A task must be local, non-owner-gated,
   dependency-ready, and bounded to declared repository paths and wall time.
2. **Durable state outside chat.** `docs/plans/unattended-backlog.json` is the
   machine-readable queue; the existing unattended ledger, handoff, ship log,
   and owner tasks remain the human record. Local JSONL events provide liveness
   evidence without storing prompts, model output, source, or secrets.
3. **Isolation and fail-closed preflight.** Execution requires Node 22, pnpm
   11.13.1, a clean `codex/` branch, current Graphify output, no root `.env*`
   file, the required durable records, and an available Codex CLI. A named
   deny-by-default filesystem profile keeps the worktree read-only except for
   the active task's declared paths. Existing ignored dependencies, build
   caches, and run state are forced read-only and snapshotted; sibling
   repositories and home files remain unreadable and tool network access is
   disabled.
4. **Deterministic evaluation outside the agent.** Backlog commands are argv
   arrays from an executable allowlist and run without a shell. The controller
   rejects missing commits, incomplete status, dirty output, out-of-scope files,
   and any failed verification command. A task may declare a bounded
   `premiseVerificationCount`; the controller runs exactly that verification
   prefix in its restricted sandbox before launching the agent and stops before
   launch on failure. The same commands run again after the checkpoint as part
   of the full profile.
5. **Hard stop conditions.** One run lock prevents concurrency. Each task has a
   5–120 minute timeout; each invocation has an explicit 1–10 task ceiling and
   stops at the first failed or uncertain result. It never attempts an automatic
   reset or rollback that could destroy evidence or user work.

Tasks that must change the controller or its trusted proof machinery use
`executionMode: "supervised"`. They remain in the same ordered backlog and can
block dependent work, but `status`, `run`, `loop`, and recovery never select
them for unattended execution. `unattended:status` reports the next eligible
one separately as `nextSupervised`. This keeps self-modification outside the
authority of the process being modified while still making the task contract
and dependency gate durable.

## Why GitHub-hosted agent writes are deferred

GitHub Agentic Workflows currently provides the best reference design for a
future remote scheduler: the reasoning job is read-only and secret-free, while
validated structured outputs are applied by a separate minimal-permission job.
OpenTenant does not install it yet because it is in Public Preview, the current
private user-owned repository cannot enforce the desired branch protection,
and hosted writes would add model credentials and a new privileged supply-chain
surface. Existing CI remains the remote verifier.

Before enabling a hosted agent, require branch/ruleset protection, a pinned and
reviewed compiler/action closure, protected files, a no-secrets agent runtime,
deny-by-default network policy, cost/concurrency limits, short-lived GitHub App
tokens in a separate output job, threat detection, and a human-reviewed PR-only
result. Never use `pull_request_target` to execute repository-controlled agent
code.

## Commands

Run from a clean isolated `codex/` worktree that does not contain `.env`:

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
pnpm unattended:status
pnpm unattended:preflight
pnpm unattended:prompt
pnpm unattended:run -- --max-tasks 1
pnpm unattended:run -- --execute --max-tasks 1
```

The first `run` form is a dry run. `--execute` launches an ephemeral
`codex exec` with no approvals, a deny-by-default filesystem profile, disabled
tool network access, and ignored user project configuration. Agent tools cannot
read sibling repositories or home files and cannot write Git metadata. The
controller rejects any ignored-state change, reviews tracked paths and the
immutable backlog transition, regenerates Graphify from read-only source, and
then creates the task checkpoint. Every verification command, including
Graphify, runs with source read-only through the same OS sandbox, with writes
limited to ignored build/cache output and a new empty home/config directory.
When `premiseVerificationCount` is present, its non-negative value may not
exceed the verification-array length. The controller runs that prefix before
agent launch, records `premise_verified` or `premise_failed` in the local
journal, and tells a launched agent not to repeat the already-established
checks. This is intended for immutable source or environment premises that the
more restricted implementation session cannot establish itself; it grants no
additional executable, network, filesystem, or task authority.
Provider variables are not forwarded and user MCP servers are unavailable.
Sanitized child paths preserve the Node runtime that launched the controller
and resolve Git from the current toolchain, so the same contract works on the
local macOS runner and GitHub's Linux CI environment.
The standalone `unattended:verify` command applies the same clean-branch,
secret-file, tool-version, and Graphify preflight before it exposes source to
test or build code.

Run state lives under ignored `.opentenant/unattended/`. On failure, inspect the
worktree, backlog, commit history, and JSONL event before deciding whether to
resume. Do not delete or reset evidence automatically.

## Refilling the queue, and repeating the run

Added 2026-08-02. The controller was safe and correct from its first run and
still needed a human to start every task, for two reasons that had nothing to do
with its sandbox.

**Nothing called it twice.** `unattended:loop` repeats the single-task runner
under explicit bounds and adds no authority of its own. It stops on the first
failure, on an empty queue, at an iteration ceiling of at most 20, or when a
time budget of at most 480 minutes is spent, and it re-runs preflight every
iteration because the tree it is checking is the tree the previous iteration
just committed to. The stop conditions are a pure function, `nextLoopAction`, so
they can be tested without launching an agent. `tooling/unattended/com.opentenant.unattended.plist.example`
schedules it and is deliberately not installed and deliberately omits
`--execute`.

**Nothing refilled it.** `selectNextTask` needs a pending, non-owner-gated task
whose dependencies are complete. On 2026-08-02 the backlog held 26 completed
tasks and three owner gates, so the loop correctly reported "no selectable task
remains" and did nothing. Every piece of work that shipped that day was created
in conversation and never became a task. Execution was never the bottleneck.

`unattended:propose` appends a task under rules that are weaker than a
hand-edit on purpose: a proposal cannot create an owner gate, cannot start in
any state but `pending`, and inherits every existing rule about verification
executables, path safety and timeouts. Validation runs over the resulting
backlog rather than the draft, so a proposal that is individually well formed
but names a dependency that does not exist fails at proposal time rather than at
selection time. The timestamp is passed in rather than read from the clock, so
the same input always produces the same file and a proposal is reviewable as a
diff.

**Fog**, borrowed from the wayfinder skill, is where a question lives when it is
in scope but not yet sharp enough to be a task. Fog carries no verification and
is never selectable, because a question you cannot phrase sharply cannot be
checked either. `unattended:graduate` turns one into a task and removes the
question in the same operation, so a decision exists in exactly one place.
Without this, unsharp questions accumulate in prose handoffs, which is how
`CODEX-HANDOFF.md` came to advertise four already-merged pull requests as
outstanding work.

```bash
pnpm unattended:loop -- --max-iterations 3 --budget-minutes 90
pnpm unattended:loop -- --execute --max-iterations 3
pnpm unattended:propose -- --file task.json --updated-at 2026-08-02T21:00:00Z --write
pnpm unattended:fog -- --file question.json --updated-at 2026-08-02T21:00:00Z --write
pnpm unattended:graduate -- --fog FOG-01 --file task.json --updated-at ... --write
```

Omit `--write` for a dry run that reports the resulting counts and changes
nothing.

**What none of this fixes.** Of the two real defects found on 2026-08-02, a
false claim committed into a handoff and a citation-boundary hole in shipped
code, neither would have been caught by any verification command in this
backlog. Both were found by an independent model reading the work. Looping the
controller multiplies output on well-specified tasks; it does not review. A
backlog that only contains build tasks will produce more unreviewed work faster.

## Building a feature with this tooling

The shortest path from an idea to reviewed, committed work.

```bash
# 1. Describe it. Four fields and at least one path; everything else is derived.
cat > /tmp/feature.json <<'JSON'
{
  "id": "BRAND-05",
  "title": "Reject brand proposals that target a revoked tenant",
  "objective": "A proposal for a revoked tenant fails at apply rather than at read.",
  "source": "docs/product/brand-and-voice-documents.md",
  "allowedPaths": ["packages/database/src", "tooling/migrations"],
  "acceptanceCriteria": [
    "Applying a proposal for a revoked tenant raises a conflict naming the tenant.",
    "An integration test writes a row the new constraint must refuse."
  ]
}
JSON
pnpm unattended:scaffold -- --file /tmp/feature.json > /tmp/task.json

# 2. Have two independent models attack the plan before anything runs.
pnpm unattended:propose -- --file /tmp/task.json --updated-at "$(date -u +%FT%TZ)" --write
pnpm unattended:review

# 3. Run it, with review of the finished diff.
pnpm unattended:loop -- --execute --review --max-iterations 1
```

`scaffold` exists because a task has thirteen fields, most of them identical
every time, and hand-writing them is why nobody wrote them. It derives priority
behind existing work, the low end of the timeout range, and the full sweep as
verification. It refuses to guess an `allowedPaths`, because the only available
default is the widest one. Its placeholder acceptance criterion is deliberately
unsatisfiable as written, so a scaffold left unfinished fails review rather than
passing it.

## Independent review, which can only ever block

Added 2026-08-02, after two real defects passed every deterministic gate on the
same day. One was a false claim committed into a handoff, asserting no prompt
assembly existed in a repository that has one. The other was a citation
boundary hole that let a cited span be truncated so it asserted the opposite of
its source. Both were found by a second model reading the work, and no
verification command in this backlog would ever have found either.

Two reviewers run at two stages. **Plan review** reads the task contract before
execution and judges whether the acceptance criteria actually determine that the
objective was met, whether the verification commands check behaviour or merely
check that something ran, and whether the objective asserts anything the agent
would have to take on trust. **Work review** reads the committed diff and looks
for claims the diff does not establish, tests that assert the implementation
rather than the behaviour, scope creep, and defects that passing tests would not
reveal.

The constraint that makes this safe to run unattended is that **a reviewer can
never approve.** It cannot promote a task or shorten any existing check; the
deterministic gates still run afterwards. This preserves the standing rule that
a model may rank or comment but may not be the certifying gate. A veto is not a
certification.

**The two stages are not symmetric, and the first live use proved why.** Both
stages originally blocked. Running one small, real task through it, moving a
brand lock-reason constant so resolve time and apply time share a vocabulary,
produced five consecutive blocked rounds. Most findings were legitimate and two
were things a human reviewer would have missed, including that a criterion
comparing a reported reason against the imported constant is tautological and
passes even if the constant's value changes. But the task never ran.

The cause is in the prompt: reviewers are told to block when uncertain. For
finished work that is right, because the diff is fixed and the question is
whether it is sound. For a specification it is close to unbounded, because every
spec can be criticised and each fix exposes a fresh seam.

So **work review blocks and plan review advises.** Plan findings are recorded in
the run record and surfaced, and the run proceeds. This weakens the plan stage
deliberately and leaves the work stage untouched: no unreviewed diff is ever
accepted, which is the property that matters. `summariseReview` is where the
policy lives, and it refuses an unknown stage rather than defaulting to the
permissive one.

Every failure mode fails closed. An unparseable reply blocks. A reviewer that
crashes, times out, or is not installed blocks. Zero verdicts blocks, so a
missing CLI cannot silently turn review into a no-op. `--execute` refuses to run
at all unless you pass `--review` or `--no-review`, because running unattended
without independent review is a defensible choice but not a default in either
direction.

Reviewers are Codex under `--sandbox read-only` and Claude Fable 5 with
`--allowedTools ""`, so neither can edit, fetch, or run anything. Plan review
needs no repository access at all; its entire input is in the prompt.

## First execute run, 2026-08-03

The first end-to-end run with `--execute --review`, on BRAND-LOCK-05. The
controller refused the result and every layer behaved as designed, so this is
recorded as the worked example rather than summarised away.

**The deterministic gates rejected it**, for two reasons. The agent never moved
its task to `not_verified`, because the backlog file was not in its allowed
paths, so it could not. And a tracked file outside scope, `.octo-continue.md`,
changed during the run; that one is editor tooling in the worktree rather than
the agent, and it still correctly failed the scope check. Both are spec and
environment defects, not agent defects.

**The blocking work review then caught two real defects** that had passed 74
platform-core tests, 88 database tests and both TypeScript checks. Codex and
Fable found the same ones independently.

The agent narrowed `RejectedBrandProposalKey.key` from `string` to
`BrandTokenKey`, which the task never asked for, and that forced `classify()` in
`brand-proposal-store.ts` to add an `isBrandTokenKey` guard to its filter. A
locked key that is not a canonical brand token is now dropped from
`rejectedKeys` while still being excluded from `applicableKeys`, so it is
neither applied nor reported. Silently. That is strictly worse than the
behaviour it replaced, and no test covered it.

It also deleted the case asserting that an empty policy fills every token from
platform defaults, replacing it rather than adding alongside.

Neither is the kind of thing a verification command finds. Both are the kind a
reader finds. That is the entire argument for the review stage, and it held on
the first real diff.

**What was fixed as a result:** the backlog file is now in the task's allowed
paths, and two criteria were added forbidding the type narrowing and requiring
that existing tests be added to rather than replaced.

## Second execute run, 2026-08-03

The same task again, after the first run's lessons were written back into it.

**The implementation was right this time.** Both defects the work review caught
in run one are absent: `RejectedBrandProposalKey.key` is still `string`, so
`classify()` keeps its original filter, and the empty-policy default case is
still in `resolve-brand.test.ts`. The database change shrank from eight lines to
two. The two acceptance criteria added after run one did their job.

**The work review blocked anyway, and it was right twice over.**

First, on a defect: the completion commit rewrote `updatedAt` as `"2026-08-02"`,
moving it backwards from `"2026-08-03T00:20:00Z"` and dropping the time
component. Every other writer uses a full ISO timestamp and `proposeTask`
requires one. Fable caught it; Codex did not. No test covers that field's
format.

Second, on a harness defect of mine. The controller writes two commits per task,
a checkpoint and a verification, so the `HEAD~1..HEAD` range the reviewer was
given contained only the backlog metadata edit and none of the work. Both
reviewers correctly reported that the diff contained no implementation, because
the diff they were shown did not. `taskDiff` now anchors on the merge base with
`origin/main`, which is what `runVerification` already did.

That is the second time a live run has failed on the review harness rather than
on the work: the first was the prompt being passed in argv where a flag consumed
it. Both were found by using it rather than by testing it, which is worth
remembering before trusting an unexercised gate.

**One acceptance criterion is unsatisfiable by construction** and should be
removed from future tasks. Asking for a premise report naming files and lines
puts the evidence in the agent's transcript, not in the diff, so a diff reviewer
cannot confirm it and will keep blocking. Verification that cannot be seen in
the artefact under review does not belong in a criterion.

After the timestamp fix, the blocking work review returned clean with no
findings, and the change is PR #47.

## Backlog policy

The initial queue mirrors all twelve slices in the accepted multi-tenant
operations delivery order. Owner-only Developer MCP, provider probes,
model/privacy policy, production, publication, and external-coordination
decisions are represented as owner-gated tasks so they are visible but never
selected. The agent may move only its active task to `not_verified`; the
controller rejects every other task-contract change and any out-of-scope dirty
path before it creates the exact task checkpoint. It then runs declared checks
in a sandboxed empty-home environment and alone promotes the task to
`completed`. Recovery accepts only the expected controller checkpoint and
reconstructs the trusted contract and diff base from its parent commit before
new work is selected.

Declared path scope is enforced both by the write-time filesystem profile and
against the completed Git diff. A task that changes ignored state or touches an
undeclared path is rejected and its evidence is retained; the controller never
resets it automatically. Unattended execution still requires an isolated clean
worktree, and external credentials, user configuration, MCP servers, provider
calls, and destructive commands remain excluded. Local probes proved declared
source writes succeed while dependency and run-state writes fail; the primary
checkout's `.env`, sibling source, and home configuration remain unreadable.

## Verified first run

On 2026-07-22 the controller completed `OPS-01` end to end: an ephemeral agent
implemented the installation-owner permission seam, the controller created the
task checkpoint, all 57 declared monorepo tasks and the platform production
build passed in the restricted verification sandbox, Graphify remained current,
and a separate completion commit promoted the task. `OPS-02` managed-support
context is now the next dependency-ready local task. The run did not read
credentials, call a provider, use tool network access, push, deploy, or merge.
