# Product requirements: Module Improvement Lab

Status: Future product direction; discovery approved, implementation deferred

Date: 2026-07-19

Owner: OpenTenant platform

Depends on: Developer MCP sandbox, module quality contracts, immutable release
evidence, authenticated previews, and controlled publication

## 1. Executive summary

The Module Improvement Lab gives each tenant-owned module a governed way to
learn from real outcomes without allowing an AI agent to silently change
production. It combines pre-release benchmarks with consented, minimised, and
redacted post-release signals. An agent may identify a recurring problem,
propose a measurable hypothesis, create a candidate in an isolated sandbox,
and compare it with the current version. A human remains accountable for every
experiment and production release.

The intended loop is:

`observe -> reflect -> code -> review -> compare -> approve or reject`

This is inspired by Replit's public description of combining benchmarks,
clustered traces, feedback, and A/B testing into a continual-learning system.
OpenTenant adds tenant isolation, explicit consent, evidence retention,
separation of duties, and deterministic rollback as product requirements.
[The Self-Driving Company](https://x.com/amasad/status/2077802290304684404)

## 2. Problem

Module teams currently discover quality problems through disconnected support
tickets, telemetry, user comments, and release regressions. Coding agents can
generate a patch, but they do not have a trustworthy definition of “better” or
a safe route from production evidence to a reviewed candidate.

Without a governed loop:

- optimisation can reward superficial engagement rather than tenant outcomes;
- raw traces can disclose tenant data, prompts, or credentials;
- an agent can overfit one incident and regress accessibility, security, or
  another user journey;
- A/B releases can become unbounded production experiments;
- automated changes can evade normal authorship, approval, and rollback
  controls.

## 3. Goals and success measures

| Priority | Goal | Initial measure |
|---|---|---|
| P0 | Human-controlled improvement | 100% of candidate experiments and releases have an attributable human approval; zero agent self-approvals. |
| P0 | Tenant-safe evidence | Zero raw tenant records, secrets, reusable credentials, or cross-tenant traces in model context, benchmarks, or shared learning. |
| P0 | Measurable changes | Every candidate names a hypothesis, target metric, guardrail metrics, benchmark change, and rollback condition before code generation. |
| P0 | Regression protection | Every candidate passes the complete versioned quality contract before it can enter an experiment or publication review. |
| P1 | Useful detection | At least 60% of pilot proposals accepted for human review correspond to a confirmed recurring issue or measurable opportunity. |
| P1 | Faster remediation | Reduce median confirmed-issue-to-reviewed-candidate time by 50% against the pilot baseline. |
| P1 | Safe experiments | 100% of experiments respect tenant-defined audience, duration, traffic, spend, and automatic rollback limits. |
| P2 | Reusable learning | Approved generic benchmark patterns can be reused without sharing tenant content, source, prompts, or generated modules. |

The pilot establishes baselines; the product must not invent historical
performance numbers.

## 4. Non-goals

- Autonomous production edits, deployment, publication, or rollback decisions.
- Training a shared model on tenant source code or tenant content.
- Cross-tenant trace pooling by default.
- Replacing support, product analytics, incident management, code review, or
  release approval systems.
- Optimising solely for clicks, session length, or another proxy without a
  tenant-approved business outcome and guardrails.
- Running experiments on sensitive or regulated workflows before the tenant
  has explicitly approved that use case.
- Giving an agent raw observability, database, identity-provider, or deployment
  credentials.

## 5. Users

### Module owner

Defines the module's desired outcomes and approves which evidence sources may
be used. Reviews opportunities and decides whether work should proceed.

### Tenant developer

Maintains the quality contract, reviews hypotheses and diffs, and uses the
Developer MCP to refine candidates in an isolated workspace.

### Tenant release approver

Reviews evidence, permissions, affected users, experiment limits, rollback,
and candidate provenance. May approve an experiment or production release but
cannot alter the immutable candidate being approved.

### Tenant security or privacy administrator

Controls signal collection, retention, redaction, regional processing,
cross-tenant learning consent, and sensitive-workflow exclusions.

## 6. Product model

### 6.1 Versioned quality contract

Each module version references an immutable quality contract containing:

- simulated user journeys and synthetic fixtures;
- expected functional and business outcomes;
- security, privacy, tenant-isolation, and authorization assertions;
- accessibility and usability checks;
- reliability and performance budgets;
- dependency, egress, and capability constraints;
- regression benchmarks derived from approved past failures;
- primary metrics, guardrail metrics, and unacceptable trade-offs.

Workspace code cannot weaken required platform checks. A proposed quality
contract change is reviewed alongside the code and is never evaluated only
against its own newly relaxed rules.

### 6.2 Evidence inputs

Eligible inputs are separately enabled per tenant and module:

- structured module errors and health signals;
- redacted interaction traces with stable event schemas;
- support issue categories and confirmed incident summaries;
- explicit user feedback;
- task-completion and tenant-approved business outcomes;
- performance, accessibility, and reliability measures;
- release and rollback outcomes.

Collection is purpose-limited and minimised before storage. Raw request bodies,
free-form tenant content, credentials, authentication material, database rows,
and unrestricted prompts are prohibited inputs. Free-form feedback must pass
redaction and prompt-injection isolation before any model can process it.

### 6.3 Operating modes

Tenant policy selects the maximum permitted mode for each module:

| Mode | Agent may do | Human gate |
|---|---|---|
| Observe | Cluster approved signals and draft an opportunity report. | Approve creation of a proposal. |
| Propose | Observe, add a regression benchmark, and create a sandboxed code candidate with comparison evidence. | Approve, reject, or request changes; no production traffic. |
| Experiment | Propose and prepare a capped A/B or canary release. | Explicitly approve audience, traffic, duration, budget, metrics, and rollback before start. |

No mode permits an agent to approve its own work or silently mutate production.

### 6.4 Improvement record

Every opportunity and candidate has a stable record connecting:

- tenant, module, baseline version, and quality-contract version;
- evidence-window identifiers and redaction policy version;
- problem cluster, confidence, and known limitations;
- hypothesis, target metric, guardrails, and stopping conditions;
- agent identity, delegating user, prompts or instructions retained under
  tenant policy, source revision, diff, dependencies, and artifact digest;
- benchmark and security results for baseline and candidate;
- reviewer decisions, experiment allocation, results, publication, and
  rollback evidence.

Records are append-only from the product's peotective. Corrections create a
new attributable event rather than rewriting the decision trail.

## 7. Functional requirements

### FR-001: Consent and signal policy

Signal collection is off by default. A tenant administrator selects modules,
sources, fields, purposes, retention, region, and eligible operating mode. The
UI previews what will and will not be collected.

### FR-002: Privacy-preserving ingestion

The platform validates event schemas, removes disallowed fields, detects likely
secrets and identifiers, applies retention at ingestion, and rejects events
that cannot be safely normalised. Raw sensitive payloads never enter the
improvement store or model context.

### FR-003: Evidence clustering

The service clusters recurring failures or opportunities using only approved
normalised features. Each cluster reports its evidence window, sample size,
confidence, affected journeys, and counterexamples. A user can inspect why an
item was grouped without seeing another user's private content.

### FR-004: Hypothesis before implementation

Before generating code, the agent must state the observed problem, proposed
mechanism, expected metric change, guardrails, affected capabilities, and
rollback condition. A human approves progression from Observe to Propose.

### FR-005: Isolated candidate generation

Candidates are built only through the Developer MCP in a fresh tenant-bound
sandbox checkpoint with synthetic fixtures, bounded commands, deny-by-default
egress, no ambient credentials, and deterministic teardown.

### FR-006: Baseline comparison

The same immutable quality contract runs against baseline and candidate. The
comparison shows absolute results, deltas, uncertainty, new failures, changed
dependencies, requested permissions, performance, accessibility, and security
findings. Selective test suppression invalidates the candidate.

### FR-007: Human review

The reviewer sees a plain-language hypothesis, evidence provenance, code and
contract diffs, benchmark comparison, data and capability impact, known
limitations, and rollback plan. Approval binds to immutable digests; later
changes require new approval.

### FR-008: Controlled experiment

Where Experiment mode is enabled, a release approver sets an eligible audience,
maximum traffic, duration, spend, success threshold, guardrail thresholds, and
automatic rollback conditions. Sensitive cohorts are excluded by policy.

### FR-009: Publication and rollback

An experiment winner becomes only a publication proposal. It must pass the
normal module release gate and separation-of-duties policy. Disable and rollback
remain available independently of the candidate deployment's health.

### FR-010: Cross-tenant learning

Cross-tenant learning is a separate opt-in. It may share only reviewed generic
benchmark patterns, taxonomy entries, and aggregate measures that meet minimum
cohort and disclosure thresholds. Tenant events, records, traces, feedback,
prompts, source, diffs, and generated modules never cross the tenant boundary.

### FR-011: Audit and revocation

Every signal-policy change, evidence read, model invocation, proposal,
workspace action, approval, experiment allocation, release, disable, and
rollback is tenant- and actor-bound in the audit chain. Revoking consent stops
new processing and applies the documented deletion policy to retained inputs.

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| Security | Least privilege, no token passthrough, no ambient sandbox credentials, prompt-injection isolation, immutable approval targets. |
| Privacy | Opt-in collection, data minimisation, field-level policy, tenant isolation, configurable retention and region, deletion evidence. |
| Safety | Human approval before code generation and experiments, policy caps, guardrail metrics, automatic rollback, emergency disable. |
| Reliability | Idempotent ingestion and actions, replay-safe allocation, deterministic candidate builds, resumable evidence jobs. |
| Explainability | Every proposal identifies evidence, hypothesis, uncertainty, expected benefit, trade-offs, and reason for each changed benchmark. |
| Portability | Evidence, experiment, sandbox, model, and deployment providers remain behind OpenTenant-owned contracts. |
| Cost | Per-tenant budgets for retained evidence, model use, sandbox time, and experiments; paid expansion requires explicit approval. |

## 9. Delivery phases

### Phase 0: Quality-contract schema

Define outcome, journey, benchmark, guardrail, evidence, and comparison schemas.
Prove baseline-versus-candidate evaluation on synthetic modules only.

### Phase 1: Observe

Add opt-in structured signals, redaction, retention, clustering, opportunity
reports, and audit evidence. No code generation or experiments.

### Phase 2: Propose

Connect approved opportunities to the Developer MCP. Generate a regression
benchmark and sandboxed candidate, run comparison, and produce a review bundle.

### Phase 3: Experiment

Add feature-flag or deployment-adapter experiments with strict allocation,
guardrails, automatic rollback, and human approval. Start with internal
synthetic tenants and low-risk workflows.

### Phase 4: Governed reuse

Evaluate opt-in generic pattern sharing only after privacy, cohort, provenance,
and tenant-review controls pass an independent assessment.

## 10. Dependencies and launch gates

- Developer MCP authentication, authorization, tenant binding, and audit.
- A production-approved `SandboxAdapter` and authenticated preview mediator.
- Immutable module versions, quality contracts, artifacts, and approvals.
- Deployment adapter with canary allocation, health checks, and deterministic
  disable/rollback.
- Tenant-configurable event schemas, consent, retention, region, and deletion.
- Feature flags are rollout controls only and never authorization.
- Security, privacy, threat-model, and model-risk reviews before any genuine
  tenant signal enters the system.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Metric gaming or local optimisation | Require outcome metrics plus security, accessibility, reliability, and tenant-defined guardrails; review trade-offs. |
| Sensitive data reaches a model | Schema-first collection, pre-storage redaction, secret detection, prohibited fields, no raw payload fallback. |
| Prompt injection in feedback or traces | Treat evidence as hostile data, isolate it from instructions, constrain tools, and require human progression gates. |
| Weak evidence produces churn | Minimum recurrence/confidence thresholds, counterexamples, Observe mode, and explicit “no change” outcomes. |
| Candidate weakens its tests | Platform-owned mandatory checks and baseline comparison against the prior contract as well as proposed additions. |
| Experiment harms users | Small default cohorts, exclusions, short duration, guardrail alerts, automatic rollback, and emergency disable. |
| Cross-tenant leakage | Default-off reuse, approved aggregates only, minimum cohort thresholds, provenance, and tenant-level revocation. |
| Agent authority expands over time | Per-action authorization, short-lived identity, capability profiles, no self-approval, and audited revocation. |

## 12. Open decisions

1. Which tenant-approved outcome types form the first quality-contract schema.
2. Which structured signals are useful enough for the Observe pilot without
   collecting free-form content.
3. Minimum sample size and confidence required before an opportunity appears.
4. Whether progression from Observe to Propose always requires a separate
   user, or can be approved by the module owner for low-risk synthetic cases.
5. Which feature-flag or deployment adapter supplies experiment allocation.
6. Default and maximum traffic, duration, budget, and rollback thresholds.
7. Regional processing and retention options for evidence and model calls.
8. Whether any cross-tenant benchmark-pattern sharing is valuable enough to
   justify its additional governance surface.
