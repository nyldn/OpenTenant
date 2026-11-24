# Safe unattended development pipeline implementation plan

> **For agentic workers:** follow the repository instructions, use a dedicated
> `codex/` worktree, and complete each behavior with RED, GREEN, review, and
> verification before selecting another task.

**Goal:** Add a resumable, dependency-aware local runner that can hand one
approved OpenTenant task at a time to Codex while failing closed around secrets,
dirty worktrees, owner gates, verification failures, and external mutations.

**Architecture:** A small private workspace package owns a versioned backlog
schema, pure selection/preflight logic, and a Node CLI. The CLI invokes Codex
only with an explicit `--execute` flag, a bounded task count, a deny-by-default
filesystem profile, disabled tool network, an ephemeral session, ignored user
configuration, and a generated task contract. The agent changes only worktree
files and marks `not_verified`; the controller validates and commits the task,
runs sandboxed empty-home verification, then commits completion independently.
It never pushes, merges, deploys, reads `.env`, or attempts rollback.

**Tech stack:** Node.js 22 ESM, built-in `node:test`, pnpm 11.13.1, Git,
Graphify, Codex CLI.

---

## Task 1: Research and provenance

**Files:**

- Create: `docs/tooling/unattended-development.md`
- Modify: `THIRD_PARTY_NOTICES.md`

- [x] Record live star counts, licences, useful mechanics, and primary links
      for OpenHands, Cline, Aider, SWE-agent, Plandex, and GitHub Agentic
      Workflows.
- [x] Distinguish inspiration from copied code and record that no third-party
      source is vendored.
- [x] Document adopted and rejected patterns, including why GitHub-hosted
      agentic writes remain deferred.

## Task 2: Backlog schema and deterministic selection

**Files:**

- Create: `tooling/unattended/package.json`
- Create: `tooling/unattended/tsconfig.json`
- Create: `tooling/unattended/src/backlog.mjs`
- Create: `tooling/unattended/src/backlog.test.mjs`
- Create: `docs/plans/unattended-backlog.json`

- [x] Write tests proving invalid schemas fail closed, owner-gated work is never
      selected, dependencies must be completed, and priority ordering is stable.
- [x] Run `pnpm --filter @opentenant/unattended test` and confirm RED because the
      public backlog functions do not exist.
- [x] Implement the smallest validator and selector, then rerun the tests GREEN.
- [x] Seed the machine-readable backlog from the approved delivery sequence in
      `docs/architecture/multi-tenant-operations.md`.

## Task 3: Fail-closed preflight

**Files:**

- Create: `tooling/unattended/src/preflight.mjs`
- Create: `tooling/unattended/src/preflight.test.mjs`

- [x] Write tests proving preflight rejects `main`, non-Node-22 execution,
      mismatched pnpm, dirty worktrees, secret-bearing environment files,
      missing required records, stale Graphify output, and missing Codex when
      execution is requested.
- [x] Run the focused test and confirm RED because preflight is absent.
- [x] Implement a pure evaluator and command-backed repository inspection.
- [x] Rerun the focused and package tests GREEN.

## Task 4: Bounded runner and evidence

**Files:**

- Create: `tooling/unattended/src/runner.mjs`
- Create: `tooling/unattended/src/runner.test.mjs`
- Create: `tooling/unattended/src/cli.mjs`
- Modify: `.gitignore`
- Modify: `package.json`

- [x] Write tests for Codex argument construction, prompt scope, lock refusal,
      non-shell verification commands, task-status/head/clean-tree gates, failure
      stop, and maximum-task enforcement.
- [x] Run the focused test and confirm RED because the runner is absent.
- [x] Implement `status`, `preflight`, `prompt`, `verify`, and bounded `run`
      commands. Store non-secret JSONL events beneath ignored
      `.opentenant/unattended/`.
- [x] Rerun package tests and CLI smoke checks GREEN.
- [x] Add temporary-Git lifecycle tests proving controller-owned task and
      completion commits, independent verification, safe recovery from
      `not_verified`, and rejection of a recovered contract mutation.

## Task 5: Integration, docs, and guarded use

**Files:**

- Modify: `docs/README.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/HANDOFF.md`
- Modify: `docs/SHIPLOG.md`
- Modify: `docs/OWNER-TASKS.md`
- Modify: `docs/plans/2026-07-20-unattended-development.md`

- [x] Run status and preflight in dry-run mode from the isolated worktree.
- [x] Run Node 22 package tests, lint/typecheck, the full monorepo check, platform
      build, `git diff --check`, link/provenance scans, and Graphify update/check.
- [x] Review the diff against the original request and security boundaries.
- [x] Commit the tooling checkpoint, then use the runner for the first ready
      approved task only if preflight and the checkpoint are clean.

## Explicit exclusions

- No automatic push, merge, pull request, deployment, provider API call,
  credential access, `.env` read, publication, or destructive Git operation.
- No unreviewed GitHub Agentic Workflow installation while the repository is
  private without branch protection and the upstream feature is in preview.
- No generic shell string from backlog data; verification commands are argv
  arrays executed without a shell.
