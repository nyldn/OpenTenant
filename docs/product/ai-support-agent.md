# Product requirements: AI Support Agent

Status: Accepted 2026-07-28. Approved for delivery in phase order.

Date: 2026-07-28

Owner: OpenTenant platform

Workstream: after `OPS-10`; hard-blocked on Developer MCP tool routes and the
publication path

Amends: section 14 of `docs/architecture/multi-tenant-operations.md`, which
previously stated that AI does not resolve a ticket by default

## 1. Executive summary

The AI Support Agent works a tenant's support queue before a human does. It
reads an incoming ticket, classifies it, attempts to reproduce the reported
problem as a failing test, and where policy allows, produces a candidate code
change, validates it in an isolated sandbox, and routes it for release. At the
highest autonomy tier permitted by installation and tenant policy, a narrow
class of change may reach a tenant's running product without a human in the
loop.

This PRD exists because that last sentence is dangerous, and the danger is
specific rather than general. Ticket content is written by a tenant's customers.
It is the most hostile untrusted input the platform accepts. Connecting it to an
actor that writes and deploys code is the exact chain recorded as `TM-011` in
`docs/security/developer-mcp-threat-model.md`, currently rated High likelihood,
High impact, High priority. Its listed mitigations are that the identity slice
"grants no tools", "sandbox commands are fixed", and "publication is disabled".
This feature removes all three.

The central design decision in this document is therefore a trust-boundary
split: **ticket prose never reaches the agent that writes code.** Triage reads
the ticket and emits a structured classification. A reproduction step converts a
candidate defect into a deterministic failing test written against the existing
codebase. Only that failing test, the repository, and the platform contracts
cross into the fix agent's context. An injection payload in a ticket body can
therefore mislead a classifier, which is bounded and reversible, but it cannot
issue instructions to the actor holding code and deploy authority.

Everything else in this document follows from that split.

**The split is a published pattern, not an invention.** It is *type-directed
privilege separation* (Jacob, Alghamdi, Hu, Alomair and Wagner,
[arXiv:2509.25926](https://arxiv.org/pdf/2509.25926)), whose headline case study
is a bug-fixing agent: a quarantined agent reads the untrusted issue and emits a
schema-constrained handoff, and a privileged agent writes the patch having never
seen the issue text. Their measured result on 180 SWE-bench Lite instances with
an injected payload in each bug report is the number to plan against:

| | Pass rate | Attack success rate |
| --- | --- | --- |
| Undefended agent | 68.3 % | 98.9 % |
| Split, as designed here | 45.0 % | 0.0 % |

**Read that cost honestly.** The split removes prompt injection and takes about a
third of the utility with it. A third of the tickets this feature could
theoretically fix, it will not fix. That is the trade, and it is the right one
at this authority level, but nobody should be surprised by the deflection rate
later.

Two ancestor patterns it also instantiates: the **dual LLM pattern** (Willison,
2023) and **LLM map-reduce with constrained map output** (Beurer-Kellner et al.,
[arXiv:2506.08837](https://arxiv.org/html/2506.08837v2) §3.1). That second paper
independently arrives at this design for software-engineering agents in §4.10.

Reference implementations exist and are worth reading before building:
Microsoft Agent Framework's FIDES (`agent_framework.security`, label propagation
and policy middleware) and Google DeepMind's CaMeL
(`camel/src/camel/quarantined_llm.py`, whose permitted output types are int,
float, bool, enum and pydantic models — the same restriction §6.1 imposes).

## 2. Problem statement

Support queues are where a multi-tenant operator's costs concentrate. A single
defect in a shared module generates one ticket per affected tenant, each handled
separately, each waiting on the same engineering fix. The operator pays three
times: for the support time, for the duplicated triage, and for the delay while
a small change waits behind unrelated work.

The existing design already removes some of that. `OPS-06` through `OPS-09`
deliver canonical ticket storage, a transactional outbox, cross-tenant owner
queues, SLA state, and delivery contracts. Section 14 of
`docs/architecture/multi-tenant-operations.md` adds optional AI assistance that
suggests category, priority, duplicates, knowledge articles, and a reply draft.

What that design deliberately does not do is act. It "does not send a public
response, disclose another tenant's content, or resolve a ticket by default".
The gap this PRD addresses is the class of ticket where the correct action is
small, mechanical, well-tested, and already obvious from the failing behaviour:
a wrong label, an off-by-one in a rendered total, a missing null guard, a stale
copy string, a misconfigured feature flag. These are cheap to fix and expensive
to route through a human queue.

**This PRD changed an accepted architectural position.** Section 14 previously
stated AI "does not resolve a ticket by default". The owner accepted tiered
autonomy on 2026-07-28 and that section is amended accordingly. Automatic
resolution is permitted under explicit per-tenant policy for a narrow and
enumerated class of change.

## 3. Goals and success metrics

Goals:

- Resolve a bounded class of defect without human involvement, while making
  every such resolution attributable, reviewable, and reversible.
- Make prompt injection through ticket content structurally unable to reach code
  or deploy authority, rather than filtered on a best-effort basis.
- Give the installation owner and each tenant independent, explicit control over
  how much autonomy the agent has, defaulting to none.
- Reduce time to first meaningful response on reproducible defects.
- Leave the deterministic support workflow fully functional when the agent is
  disabled, failing, or slow.

Success metrics, measured per tenant:

| Metric | Definition | Target |
| --- | --- | --- |
| Deflection rate | Tickets closed by the agent and not reopened within 14 days, over all eligible tickets | Establish baseline; no target in v1 |
| False resolution rate | Agent-closed tickets reopened within 14 days | Below 5 %, hard stop at 10 % |
| Rollback rate | Agent-originated releases rolled back within 24 hours | Below 2 %, hard stop at 5 % |
| Time to first response | Ticket creation to first substantive reply, agent or human | Improvement against pre-agent baseline |
| Injection attempts detected | Tickets where classification output failed schema validation or tripped a guard | Reported, not targeted |
| Spend per resolved ticket | Sandbox, model, and CI cost divided by agent resolutions | Below the loaded cost of human handling |

Hard stops are automatic. Breaching the false-resolution or rollback ceiling
drops the tenant to autonomy tier T0 and raises an owner alert. Recovery is a
human action, not a timer.

## 4. Non-goals

- Replacing tenant or owner support staff. The agent handles a narrow class and
  escalates everything else.
- Answering from another tenant's tickets, knowledge, or code.
- Any change to authentication, authorization, permission grants, role
  definitions, or tenant boundaries. Permanently excluded at every tier.
- Any schema migration, data backfill, or destructive data operation.
- Any dependency addition, removal, or version change.
- Editing OpenTenant-owned native platform modules.
- Acting on tickets whose requester would directly benefit from the change, as
  defined in section 7.6.
- Raw provider credentials, deploy tokens, or database connection strings in an
  agent or sandbox context. Inherited from the Developer MCP non-goals and not
  relaxed here.
- Sending a public reply that the agent composed without either a human approval
  or an explicit tier that permits it.
- Operating on production tenant data during reproduction. Synthetic and
  redacted fixtures only.

## 5. User personas

### Persona A: Owner support operator

Runs the cross-tenant helpdesk. Wants the queue to contain only tickets that
need a person. Needs to see, at a glance, what the agent did, why, and how to
undo it. Distrusts the agent by default and is right to.

### Persona B: Tenant administrator

Owns their organisation's support experience and their product's stability.
Decides whether the agent may act inside their tenant at all, and at which tier.
Cares more about a bad auto-deploy than about queue depth.

### Persona C: Platform engineer

Reviews agent-proposed changes at tiers T1 and T2. Needs the failing test, the
diff, the sandbox evidence, and the policy decision in one place. Will disable
the feature permanently if reviewing its output costs more than writing the fix.

### Persona D: The requester

A tenant's customer. Never interacts with the agent directly and is never told a
human wrote something a model wrote. Sees a normal ticket lifecycle.

### Persona E: The adversarial requester

Also a tenant's customer. Files tickets designed to steer the agent into
granting access, exfiltrating data, or shipping hostile code. Every control in
section 7 assumes this persona is present.

## 6. Product principles and architecture

### 6.1 The trust-boundary split

This is the load-bearing decision.

```text
untrusted zone                    │ trusted zone
                                  │
ticket body, attachments,         │
requester metadata, prior         │
public replies                    │
        │                         │
        ▼                         │
  Triage agent                    │
  - no tools                      │
  - no repo access                │
  - schema-constrained output     │
        │                         │
        ▼                         │
  Classification record ──────────┼──▶  Reproduction harness
  (enum fields only)              │     - reads repo + fixtures
                                  │     - writes a failing test
                                  │     - never reads ticket prose
                                  │            │
                                  │            ▼
                                  │      Failing test + repo
                                  │            │
                                  │            ▼
                                  │      Fix agent (Developer MCP sandbox)
                                  │      - sees test, repo, contracts
                                  │      - never sees ticket prose
                                  │            │
                                  │            ▼
                                  │      Candidate release
```

The classification record carries only enumerated values and bounded scalars:
category, severity, suspected module, suspected route, reproducibility flag, and
a confidence score. It carries **no free text**. Free text is the injection
vector; removing it from the boundary removes the vector.

### 6.1.1 The channel must be bounded, not merely typed

A typed channel with unbounded cardinality is still a pipe. An unbounded array
of `(file_index, role, start_line, end_line)` tuples carries roughly 24 bits of
attacker-chosen entropy per element; fifty elements is 150 bytes of payload
smuggled to the privileged agent as integers. Jacob et al. cap array length
explicitly "to prevent the possibility of decoding attacks".

Therefore, binding on every field that crosses the boundary:

- every enum has fixed, enumerated cardinality declared in the schema;
- every array has a hard maximum length;
- every integer has a validated range, and line numbers outside the target
  file's actual length are rejected rather than clamped;
- the schema is **rejected whole** on any violation. Nothing is coerced,
  defaulted, or partially applied.

### 6.1.2 Triage sees no private data

The triage model reads untrusted content, so anything else in its context can
leave through the enum at a few bits per ticket, and an attacker can file a
hundred tickets. Triage therefore gets the ticket and nothing else: **no
repository access, no ticket history, no customer records, no retrieved
knowledge, no other tenant's anything.** This is what keeps the enum a
classification channel rather than an exfiltration channel.

### 6.1.3 The generated test must not re-open the prose channel

The reproduction harness is deterministic, but the fix agent reads its output.
If any part of a generated test derives from ticket-controlled text — a test
name, a docstring, a string literal, a fixture path — the prose channel is
reopened with extra steps.

The harness therefore composes tests from a fixed template catalogue keyed on
the enum, with **zero string interpolation from the classification record**.
Numeric substitution only. File paths resolve through a pre-built out-of-band
index, never from a model-supplied string. A test is asserted to match its
template plus a bounded set of numeric substitutions before it is allowed to
run.

The reproduction harness is deterministic code, not a model. It maps a
classification to a candidate test using the module's existing test conventions.
Where it cannot produce a failing test, the ticket escalates to a human and the
pipeline stops. **No failing test, no code change.** This single rule eliminates
the largest category of bad agent behaviour: confident changes to things that
were never broken.

### 6.1.4 What the split does not stop: task steering

The split defeats *instruction* injection. It does not defeat *task steering*,
and no published system does. Every source concedes this and the PRD must not
claim otherwise.

The attack: a ticket reads as a benign report but is crafted so triage returns
`bug_category = AUTH_BYPASS` with `code_regions` pointing at session-validation
middleware. The harness dutifully generates a failing test asserting behaviour
in the auth path. The fix agent, which has no reason to distrust a
deterministically generated test, edits authentication code until it passes. No
injected string ever crossed the boundary. The attacker steered the run by
choosing one of our own enum values.

**The containment is the path exclusion list in section 7.5, not the split.**
Because authentication, authorization, permissions, roles, schema, migrations,
the audit pipeline, delivery adapters, dependency manifests and CI config are
excluded at every tier, the attack above produces a rejected candidate rather
than an auth change. Beurer-Kellner et al. and Jacob et al. both identify
steering as unsolved and neither implements a diff-scope policy against it;
this is the one place where this design goes beyond the published work, and it
is load-bearing rather than incidental.

Two further consequences:

- **Category-scoped diff policy.** The exclusion list is global, but scope also
  narrows per category. A `UI_COPY` classification must be structurally unable
  to produce a diff outside presentation code. A category may only ever narrow
  the allowlist in section 7.5, never widen it.
- **Failure paths are channels too.** What the harness does on
  `insufficient_information`, an out-of-range enum, or a schema rejection is
  itself observable and repeatable. The failure path must be no more privileged
  than the success path, and must not leak which branch was taken.

The defensible claim, and the only one this document makes: **the split reduces
the attack from arbitrary code execution to bounded task misdirection, and
diff-scope policy, egress denial and human review contain the remainder.**

### 6.2 Autonomy tiers

Tiers are set per tenant by the tenant administrator, bounded above by an
installation-owner ceiling. The effective tier is the lower of the two. Default
for both is T0.

| Tier | Agent may | Human required for |
| --- | --- | --- |
| **T0 Observe** | Classify, suggest category and priority, flag duplicates, draft a reply | Everything. Matches the current accepted architecture. |
| **T1 Propose** | Everything in T0, plus reproduce, write a candidate patch, run validation, and open a change proposal | Merge and release |
| **T2 Stage** | Everything in T1, plus release automatically to a non-production tenant environment | Production release |
| **T3 Resolve** | Everything in T2, plus release to production for changes matching an enumerated policy class, and close the ticket | Nothing, in-band. Review is after the fact. |

T3 is the tier the owner asked for and the one that carries real risk. It is
constrained in section 7.5 rather than by good intentions.

### 6.3 Identity and attribution

The agent is a service identity, not a person and not an impersonation of one.
Every action it takes appends evidence carrying the service identity, the tenant,
the originating ticket reference, the effective tier, the policy version that
authorised it, the classification record digest, the failing-test digest, and the
artifact digest. This satisfies the cross-scope evidence contract in section 15
of `docs/architecture/multi-tenant-operations.md`.

Public replies attributed to the agent are labelled as automated. The platform
never presents model output as a named human's words.

### 6.4 Relationship to existing components

The agent introduces no new execution substrate. It composes:

- the support module's canonical ticket store and outbox (`OPS-06`, `OPS-09`);
- the Developer MCP sandbox, template, policy, preview, and evidence pipeline
  (`docs/product/developer-mcp.md`, `adr-005`);
- the module publication path and its approval separation (`TM-010`); and
- the audit chain and evidence export in `packages/database`.

Where this PRD and the Developer MCP PRD disagree, the Developer MCP PRD wins,
except where section 12 records an explicit owner override.

## 7. Functional requirements

### 7.1 Eligibility

A ticket is agent-eligible only when all hold:

- the tenant's effective tier is T1 or higher;
- the support module is enabled for the tenant;
- the classification confidence exceeds the tenant's threshold;
- the suspected module is tenant-private or installation-owned, never
  OpenTenant-native;
- no attachment failed malware scanning;
- the ticket is not linked to an open incident; and
- the requester is not in the exclusion set of section 7.6.

Ineligible tickets follow the existing human workflow with no visible change.

### 7.2 Triage

The triage agent receives ticket body, public replies, and bounded contextual
intake metadata. It receives no tools, no network, and no repository access. Its
output must validate against a closed schema; a validation failure is recorded
as a possible injection attempt, and the ticket escalates.

Attachment contents are never passed to triage in v1. Attachment *metadata*
may be.

Triage output is validated in code after the model returns, not trusted because
a schema was requested: enum membership, integer ranges and array lengths are
all re-checked, and any violation rejects the whole record. Cheap preconditions
run first and skip the model call entirely where the action is already
impossible.

### 7.3 Reproduction

The harness selects a test template from the suspected module's existing test
suite conventions and parameterises it from the classification record's
enumerated fields only. It runs against synthetic fixtures in the sandbox.

Outcomes:

- **Fails as expected** — proceed.
- **Passes** — the reported problem is not reproducible from the classification.
  Escalate to a human with the attempt attached.
- **Errors** — escalate.

**This gate is stricter than anything in the field, and the field is bad at
this.** A source review of the leading agents found three tiers. SWE-agent and
OpenHands treat reproduction as a *prompt suggestion*: the model is asked to
write a reproduction script, nothing verifies that it failed, and the script is
deleted afterwards. Agentless and AutoCodeRover verify that a generated test
fails against the unpatched repo, but Agentless runs it in parallel with the
patch as a ranking signal rather than a precondition, and AutoCodeRover, which
does raise on failure to reproduce, then catches its own exception and patches
anyway. Aider has no reproduction concept at all.

So "no failing test, no code change" is novel as an *enforced gate*, though
unremarkable as an aspiration. Two consequences worth stating before anyone
commits to a delivery date:

- **Expect a low reproduction rate.** SWT-Bench exists precisely because agents
  are poor at generating reproducing tests, and reports success rates in the
  teens for GPT-4-class SWE-agent runs. If P1's reproduction precision lands
  there, the gate is working and the feature is narrow. That is the honest
  expectation, not a disappointment.
- **This design does not fall back.** Where AutoCodeRover degrades to patching
  without a reproduction, this escalates to a human and stops. The reviewer will
  ask "what happens when it cannot reproduce?" and the answer is: nothing
  happens, which is the point.

### 7.4 Fix generation

The fix agent runs inside the existing Developer MCP sandbox under its existing
policy: deny-by-default network, no ambient credentials, fixed command set,
bounded duration and output, deterministic teardown.

Its context contains the repository, the platform contracts, and the failing
test. It does not contain the ticket, the classification record's free-text
fields (there are none), the requester's identity, or any other tenant's
material.

A candidate is rejected automatically if the diff touches an excluded path
(section 7.5), if the previously failing test does not pass, if any other test
regresses, if coverage on the changed lines is absent, or if the diff exceeds the
tenant's configured size ceiling.

### 7.4.1 Validation strategy, and what is deliberately not adopted

Three strategies exist in the field. This design takes one and rejects two.

**Adopted: execution-grounded differential validation.** The SWE-bench
fail-to-pass / pass-to-pass shape. A regression baseline is established by
running the existing suite against the unpatched repository and recording what
passed; the patch must make the generated test pass and must not break anything
in that baseline.

**Rejected: an LLM that prunes the regression set.** Agentless improves its
numbers by having a model remove regression tests it expects the fix to
legitimately break. That is a model deciding which regressions do not count, and
it is an integrity hole directly in the path this feature most needs to trust.
The regression baseline here is mechanical and no model may subtract from it.

**Rejected: LLM-as-judge as the certifying authority.** SWE-agent scores
candidates with a model judge, and AutoCodeRover's reviewer can send the *test*
back for regeneration when it disagrees with it. That bidirectional correction is
elegant and it is exactly how an agent talks itself into weakening a test. A
judge that can revise the test cannot certify the patch. A model may rank or
comment here; it may not be the gate.

**No silent degradation.** Agentless drops the reproduction requirement when no
candidate satisfies both filters. This design fails the run instead and
escalates. Any future relaxation is a new acceptance, not a tuning decision.

### 7.4.2 Test immutability

The only defence against "weaken the test until it passes" in the entire field
is SWE-bench's harness, which resets test files with
`git checkout {base} -- {test_files}` before grading. That works only because
the benchmark has an oracle listing which files are tests. Production has no
such oracle.

Therefore: the generated test is written to a location the fix agent cannot
write to, and existing test files are on the excluded-path list for the fix
agent specifically. Validation re-reads the test from its immutable location
rather than from the agent's working tree, and a candidate whose diff touches
any test file is rejected outright rather than reset. SWT-Bench also reports
agents mutating `setup.py`, `pyproject.toml` and `requirements.txt` to force a
pass, which is already covered by the dependency-manifest exclusion in 7.5 and
is now covered for a documented reason rather than an assumed one.

### 7.5 Release, and what T3 may actually touch

At T3, a change may release to production without human approval only if **all**
of the following hold. This is an allowlist, and anything not enumerated is
excluded.

Change-class allowlist:

- user-facing copy and translation strings;
- presentational styling within an existing component;
- a null or bounds guard added to existing logic;
- a configuration or feature-flag value within a pre-declared allowed range.

Path exclusions, absolute at every tier:

- anything under authentication, authorization, permissions, or roles;
- tenant resolution and request-context binding;
- database schema, migrations, and query construction;
- the audit and evidence pipeline;
- outbound delivery adapters and credential handling;
- dependency manifests and lockfiles;
- CI, deployment, and infrastructure configuration.

Additional T3 gates:

- the change is content-addressed and the release binds the manifest, artifact,
  and policy digests, per `TM-010`;
- an automated rollback trigger is armed before release, watching error rate,
  latency, and ticket-reopen velocity for a configurable window;
- a per-tenant rate limit caps agent-originated production releases per day;
- a cool-down blocks a second agent release to the same module until the first
  clears its watch window; and
- the tenant's SLA state and CSAT flow are unaffected by the resolution being
  automated;
- the release risk tier is derived from the classification enum by a
  **deterministic table**, never predicted by a model. A model that can choose
  its own risk level is the OpenHands failure mode, where the acting model
  populates the enum that decides whether a human is asked;
- the fix agent runs with **deny-by-default egress**, so any residual attack
  loses its exfiltration half; and
- agent-originated releases are **rate limited and correlated per requester**.
  Every surviving attack in section 6.1.4 is low bandwidth and only works at
  volume.

The agent cannot approve its own release at any tier. At T3 the approval is
carried by the *policy*, pre-authorised by a human, not by the agent's judgment.
This is the distinction that keeps `TM-010` mitigated.

### 7.6 Requester-benefit exclusion

A ticket is excluded when the requester could gain from the change. Concretely,
when the requester holds an elevated role in the tenant, or when the
classification's suspected module is one where the requester has a pending
request, an open dispute, or a billing relationship. Where the platform cannot
determine this cheaply, it excludes.

This is the control against "please fix the bug where I am not an administrator".

### 7.5.1 Evidence bundle

Every run emits a bundle binding: base commit, patch digest, generated-test
digest, pre-patch test output, post-patch test output, regression baseline
digest, environment digest, the classification enum, and the policy version in
force.

This is unclaimed territory rather than a convention being followed. The source
review found nothing content-addressed anywhere in the field: SWE-bench hashes
only Docker build inputs for cache keys, SWE-agent writes an unsigned trajectory
JSON, OpenHands exports a conversation zip with no hashing in its client, and
Aider keeps lint and test outcomes in memory only. Nothing durable in any of
them attests "these tests passed against this diff." Since T3 releases without a
human in the loop, that attestation is the artifact an incident review depends
on, and it has to be built rather than borrowed.

### 7.6.1 Provenance shown to the reviewer

Every change proposal carries, visibly: the originating ticket reference, the
classification enum that produced it, and an explicit statement that the task
originated from customer-authored content. A reviewer approving a diff must be
able to see that the task origin was untrusted without going looking for it.

### 7.6.2 Suggested knowledge: retrieval, provenance and grounding

P0 surfaces suggested knowledge articles alongside a classification. A third
source review covered Onyx, RAGFlow and Dify to find a retrieval-permission
model worth copying rather than inventing.

**Copy Onyx's enforcement shape.** It is the only one of the three where tenant
and ACL are engine-level pre-filters rather than post-filters or API-layer
checks. The access list is denormalised onto every chunk at index time as
prefixed opaque strings and pushed into the query as a mandatory filter clause,
so the engine never scores an inaccessible chunk. Critically, **tenant is bound
from ambient request state, not from a caller-supplied argument**, which means a
caller cannot forget it or spoof it through a search body. That property is the
one to preserve; it matches how `withTenantContext` already works here.

**Three things not to copy.**

- Onyx types its access list as optional, where absent means *unrestricted*.
  That is fail-open by type. Here the tenant-bound access set is non-optional,
  and any bypass requires an explicit, audited sentinel rather than a null.
- RAGFlow partitions by index name but passes tenant as a plain function
  argument, and has retrieval paths that fall back to a lookup with no
  accessibility check. Structural separation with an advisory boundary is not a
  boundary.
- Dify's licence forbids operating a multi-tenant environment at all. Do not
  read it for architecture, and do not depend on it.

**Provenance must go finer than the field does.** Onyx's citation carries only a
citation number and a document id: no chunk, no offset, no span. A model that
emits a citation marker for a document that was never retrieved has that marker
*silently deleted from the visible answer*, so the reader sees the claim with no
citation and no indication anything was removed. RAGFlow is worse: when the
model emits no marker it attaches citations by embedding similarity with a
threshold that decays until something matches, and if that fails it presents the
entire retrieved set as sources, so a fully hallucinated answer ships with a
complete-looking bibliography.

Therefore, for suggested knowledge here: citations bind to **chunk id plus
character span**, an uncited claim is a rejected suggestion rather than a
silently stripped marker, and no similarity-decay fallback is permitted.

**Abstention and grounding are ours to build.** Onyx has no score threshold
anywhere, and its relevance filter is inert because the `NOT_RELEVANT` verdict is
discarded by the caller. RAGFlow's abstention string defaults to empty, which is
falsy and disables it. Neither project gates on groundedness; Onyx's only
groundedness metrics live in an unwired script whose dependency is not declared.
So the explicit `abstain` enum from section 7.2 applies here too, and a
suggestion below the grounding threshold is withheld rather than shown with a
caveat.

**Deletion must be event-driven.** Onyx orders index-delete before
database-delete correctly, but ordinary incremental indexing does not detect
source deletions at all; that is left to a pruning sweep whose default frequency
is one week. A document deleted at source therefore stays answerable, with a
live citation, for up to seven days. Revocation and deletion here are driven by
events from the canonical store, and the sweep is a reconciler rather than the
mechanism.

**Publication review has no prior art.** None of the three has a
draft-to-review-to-publish state machine; Onyx offers only admin hide and boost
plus a curator role. The human-reviewed, source-provenanced publication path
this design requires has to be built.

### 7.7 Resolution and reopening

When the agent resolves a ticket it posts a labelled automated reply describing
what changed, links the release, and closes the ticket. Reopening is always
available to the requester, escalates immediately to a human, and disables agent
autonomy for that ticket permanently.

Reopen velocity feeds the false-resolution metric and the hard stop.

### 7.8 Owner and tenant controls

- Per-tenant tier selection, bounded by the installation ceiling.
- Per-module opt-out.
- A global kill switch that stops agent activity within one minute, leaving the
  deterministic workflow untouched.
- A queue view of agent activity: proposals, releases, rollbacks, escalations,
  and detected injection attempts.
- Budget caps per tenant and per day, with the agent degrading to T0 on breach
  rather than queueing.

## 8. Non-functional requirements

- Agent failure, timeout, or unavailability never blocks ticket creation,
  reply, assignment, or escalation. The deterministic workflow is the system of
  record.
- **Loop control**, adopted from the field because these heuristics are the one
  thing it has genuinely converged on: a hard per-run cost cap and call limit; a
  bounded requery count on malformed output; and stuck detection that aborts on
  repeated identical action/observation pairs, repeated identical erroring
  actions, agent monologue, and alternating patterns. A stuck run escalates; it
  does not retry indefinitely.
- **Sandbox posture is a differentiator and should be stated as one.** The
  source review found that not one leading agent restricts network egress or
  ambient credentials by default. SWE-bench sets no network, memory or CPU
  limits at all; OpenHands has the most complete configuration in the field and
  still ships no default egress block. "Runs in Docker" is what everyone else
  means by sandboxed. This design inherits the existing OpenTenant sandbox
  contract instead: deny-by-default egress, no ambient credentials, fixed
  command set, bounded duration, bounded output, deterministic teardown.
- Reproduction and fix generation are bounded in duration, output size, and
  spend, inheriting the sandbox limits already proven in `packages/sandbox`.
- All agent state mutations append audit evidence in the same transaction as the
  mutation, per `TM-009`.
- Cross-tenant isolation is enforced server-side from the ticket's tenant
  binding. No caller-supplied tenant or workspace identifier is trusted, per
  `TM-002`.
- Model provider outages degrade to T0 silently.
- Evidence retention matches the tenant's configured support retention.

## 9. Implementation phases

| Phase | Delivers | Gate to exit |
| --- | --- | --- |
| **P0** | Triage only, T0. Schema-constrained classification with bounded cardinality, explicit `abstain` enum member, suggestion surfacing, injection-attempt telemetry. Triage context is the ticket alone. No repository access anywhere in the feature. | Classification accuracy baseline; abstention rate measured as a first-class metric; zero schema escapes over a defined observation period; **red-team suite of steering tickets runs in CI with a measured attack success rate** |
| **P1** | Reproduction harness. Template-catalogue test generation with numeric substitution only, out-of-band path resolution, template conformance asserted before execution. Escalation on any non-failure, with no fallback path. Still T0 for the tenant. | Reproduction precision baseline **measured against the field's teens-range expectation, and judged as a go/no-go for P2 spend**; no fixture reaching production data; zero ticket-derived strings present in any generated test, asserted mechanically |
| **P2** | T1 proposals. Fix generation in the sandbox with deny-by-default egress, mechanical regression baseline, immutable generated test, digest-bound evidence bundle. Human merges. | Human reviewers report proposals are cheaper to review than to write; category-scoped diff policy proven to reject an out-of-scope patch; **a deliberate test-weakening attempt proven to be rejected**; every proposal shows the reviewer that a customer authored the originating ticket |
| **P3** | T2 staging releases. Automated non-production release and rollback rehearsal. | Rollback proven under injected failure |
| **P4** | T3, per-tenant opt-in, allowlisted change classes only. | Owner sign-off against section 12; false-resolution and rollback rates inside targets through P3 |

Phases are not compressible. P4 without P3's rollback proof is the failure mode
this document exists to prevent.

**Schema design is real work, not a detail.** Jacob et al. report their handoff
schema took "considerable testing on our development split" to get right. Budget
P0 for schema iteration rather than treating the enum set as something to write
once.

## 9.1 Prior art, and where this design sits relative to it

Two source reviews informed these phases: one of open-source helpdesk AI triage
(below), and one of issue-to-patch coding agents (SWE-agent, OpenHands,
Agentless, AutoCodeRover, Aider, and the SWE-bench and SWT-Bench harnesses).

From the coding-agent review, four things this design does that the field does
not: enforce reproduction as a gate rather than a prompt, keep the regression
baseline free of model judgement, make the generated test unreachable by the fix
agent, and emit digest-bound evidence. And one thing the field does better than
this document did before the review: publish honest failure rates.

**Licence note.** AutoCodeRover is under the SONAR Source-Available License and
is not OSI open source. Study only; never vendor. SWE-agent, SWE-bench,
Agentless, SWT-Bench and OpenHands are MIT; Aider is Apache-2.0.

**Citation hygiene.** `All-Hands-AI/OpenHands` main is now a TypeScript UI; the
Python runtime moved to `All-Hands-AI/agent-sdk`. Any future reference to
"OpenHands does X" needs a repo and tag or it will not be checkable.

A source review of the leading open-source helpdesks was run before writing
these phases. The finding is worth recording, because a reviewer will otherwise
assume these constraints restate standard practice. They do not.

**Zammad** (AGPL-3.0) has the right skeleton and no enforcement. Instructions
sit in the system message and ticket content in the user message, XML-tagged,
with an explicit per-article `<visibility>internal|public</visibility>` marker.
But the templates are plain ERB with no escaping, so a customer who writes a
closing tag walks straight out of the envelope. Its result validation is
key-presence only: a declared `'integer'` is never type-checked, and an
out-of-allowlist group ID is applied anyway.

**Chatwoot** (MIT core; the Captain AI subsystem is under a proprietary
`enterprise/` licence and must not be copied) renders contact name and arbitrary
custom attributes directly into the **system prompt**, unescaped. On a public
widget inbox the visitor controls their own name. Its conversational agent holds
label, priority, resolve and arbitrary-outbound-HTTP tools in the same model
call that reads customer text.

Neither project has a confidence score. Neither has an evaluation harness for
classification quality. Both auto-apply triage without review.

Three patterns are worth taking, with attribution:

- Zammad's **role split with a visibility marker** per article, which this
  design keeps and then actually escapes.
- Zammad's **cheap preconditions** that skip the model call entirely when the
  action is already impossible, a free reduction in exposure surface.
- Chatwoot's **provenance join** (`captain_faq_observations`), where every
  derived artifact points at the exact source records with a uniqueness
  constraint preventing double-counting.

One pattern is worth explicitly rejecting: both projects treat abstention as
"return an empty value and drop it", which silently conflates *no match* with
*model failed* and makes abstention unmeasurable. This design uses an explicit
`abstain` enum member with a separate reason code, so abstention rate is an
observable metric from P0.

## 10. Risks and mitigations

| ID | Risk | Mitigation |
| --- | --- | --- |
| R-1 | Prompt injection through ticket content reaches code or deploy authority | Trust-boundary split (6.1). Ticket prose never enters the fix agent's context. Classification schema carries no free text. |
| R-2 | Agent ships a confident fix for a non-existent defect | No failing test, no change (6.1, 7.3). |
| R-3 | Requester engineers a change that benefits them | Requester-benefit exclusion (7.6) plus absolute path exclusions on auth and permissions (7.5). |
| R-4 | Auto-deploy breaks a live tenant | Allowlisted change classes, armed rollback, rate limit, cool-down, watch window (7.5). |
| R-5 | Agent self-approves | Approval is carried by pre-authorised policy, never by the agent. Inherits `TM-010` controls. |
| R-6 | Cross-tenant leakage through shared model context | Per-tenant context isolation; no cross-tenant retrieval; inherits `TM-002` server-side binding. |
| R-7 | Cost amplification, one sandbox per ticket | Budget caps with degradation to T0; eligibility gating; inherits `TM-008` quotas. |
| R-8 | Metric gaming, agent closes tickets to improve deflection | Deflection is defined net of reopens; false-resolution rate is a hard stop, not a dashboard. |
| R-9 | Reviewer fatigue at T1 and T2 leads to rubber-stamping | P2 exit gate is explicitly that review is cheaper than writing; if it is not, the feature stops. |
| R-10 | Silent degradation of support quality | CSAT and SLA apply unchanged to agent-resolved tickets; reopen escalates to a human immediately. |
| R-11 | **Task steering: attacker picks the enum and aims the agent at sensitive code** | Global path exclusions (7.5) plus category-scoped diff policy (6.1.4). This is the residual risk the split does not cover; treat it as the primary threat, not a footnote. |
| R-12 | Decoding attack: payload smuggled through unbounded arrays or integers | Bounded cardinality, capped array length, validated integer ranges, whole-record rejection (6.1.1). |
| R-13 | Exfiltration through the classification channel | Triage context contains the ticket and nothing else (6.1.2); rate limiting and correlation per requester. |
| R-14 | Prose re-enters through the generated test | Template catalogue keyed on enum, numeric substitution only, paths from an out-of-band index, template conformance asserted before execution (6.1.3). |
| R-15 | Supply chain: the fix agent ingests untrusted dependency and vendored code the split never covered | Sandbox execution with deny-by-default egress; the split protects against the ticket, not against the repository's own inputs. |
| R-16 | Agent weakens or deletes a test to force a pass | Generated test written where the fix agent cannot reach it; existing tests on the agent's excluded-path list; validation re-reads from the immutable location; any diff touching a test file is rejected (7.4.2). Documented behaviour in the field, never measured by anyone. |
| R-17 | Reproduction rate is so low the feature is not worth operating | Accepted and measured, not mitigated. SWT-Bench reports teens for comparable work. P1's exit gate is a measured baseline precisely so this can be judged before P2 spends money. |
| R-18 | Suggested knowledge cites a source the reader cannot see, or cites nothing at all | Index-time ACL denormalisation with mandatory query-time pre-filter bound from ambient tenant context; citations bound to chunk plus span; uncited claims rejected rather than stripped (7.6.2). |
| R-19 | Deleted or revoked source stays answerable | Event-driven revocation from the canonical store, with the periodic sweep demoted to a reconciler. The field's default is a weekly sweep, which leaves a seven-day window (7.6.2). |

## 11. Dependencies

Current status, reconciled 2026-11-17: the full Support Agent remains unfinished.
The narrower OPS-12 `SupportAiService` provides review-required suggestions,
knowledge scoping, citation checks, bounded failure behavior, and local
evaluation coverage. It is a foundation for P0, not P0 itself. P1 through P3 are
deferred, and P4 remains owner-gated after the earlier phase evidence. See the
[current requirement ledger](../plans/product-requirements-status.md) for phase
status and source/test references.

The hard dependencies are at different stages:

- **Developer MCP tool routes.** The local `workspace.create` route has a
  [real microVM route receipt](../reviews/2026-11-17-developer-mcp-route.json),
  including OAuth/PKCE, confirmation, teardown and a single-use static preview.
  `OWNER-DEVELOPER-MCP-02` still gates production activation. This bounded
  synthetic template path does not implement the Support Agent fix workflow.
- **Module publication.** Currently disabled. T2 and T3 require it, with
  `TM-010` approval separation still required.
- **Hosted sandbox isolation probe.** `TM-003` records that hosted isolation,
  metadata blocking, and deletion are not live-proven.
- **Support delivery.** Durable email, ticket UI and persistent review-only
  suggestions have [local receipts](../adopters/wave5-wiring-verification.md).
  Routed generation and rejected-output quarantine remain disabled; the
  separate P0 classification journey and remaining phase work are not delivered.

Soft dependencies: SLA state from `OPS-09`, the knowledge module for suggested
articles, and the evidence export path from section 15 of the operations
architecture.

## 12. Decisions

### Settled on acceptance, 2026-07-28

1. **Does T3 ship?** Yes. Section 14 of
   `docs/architecture/multi-tenant-operations.md` is amended to permit tiered
   autonomy up to automatic resolution and production release, bounded by the
   change-class allowlist in section 7.5.
2. **Default posture.** T0 for both the installation ceiling and every tenant.
   Autonomy is opt-in at both levels and the effective tier is the lower of the
   two.
3. **Phase order is binding.** P4 cannot ship before P3 proves rollback under
   injected failure. Compression is not an owner call available later; it would
   need a new acceptance.

### Still open, and not blocking P0 through P2

4. **Who owns the T3 blast radius?** If an agent-originated release breaks a
   tenant's product, is the liability the installation owner's or the tenant's?
   This is a licence and contract question, not a technical one. It must be
   answered before P4 opens, not before delivery starts.
5. **Is the change-class allowlist in 7.5 the right list?** It is deliberately
   narrow. Widening it is the obvious pressure once the feature works, and each
   widening is a fresh acceptance.
6. **Model provider and data residency.** Settled by
   `docs/architecture/adr-006-model-selection-and-residency.md`: provider is
   configurable across OpenAI, Anthropic and OpenRouter, selectable per module
   and use case within an owner-published allowlist, and residency is derived
   from the tenant's Neon region and enforced as a filter on that allowlist
   rather than recorded as documentation. A residency mismatch fails the call.
   OpenRouter is unavailable to a residency-constrained tenant unless the owner
   has pinned its upstream provider and data policy. A tenant may accept
   cross-border processing explicitly, recorded as evidence naming the specific
   provider and region rather than as a boolean; declining with no compliant
   in-region model routes to provisioning in a different region rather than a
   dead end. Withdrawal fails closed.
7. **Disclosure.** Must a tenant tell their customers that an agent may act on
   their ticket? Assume yes pending advice.
8. **Attachment handling.** v1 excludes attachment contents from triage. Images
   of error screens are among the most useful signals; enabling them reopens the
   injection surface through a different modality.

## 13. Self-score

| Axis | Score | Note |
| --- | --- | --- |
| Problem clarity | 4 / 5 | The cost case is argued but not quantified against a real queue |
| Solution specificity | 4 / 5 | The trust-boundary split and tier model are concrete; the change-class allowlist needs review by someone who owns the codebase |
| Risk coverage | 4 / 5 | Mitigations trace to threat-model entries and to published work, but task steering (R-11) is contained rather than solved, and no published system solves it |
| Deliverability | 2 / 5 | Accepted, but still hard-blocked on two components that do not exist yet |
| Measurability | 4 / 5 | Metrics defined with hard stops; baselines not yet collected |

Risk coverage dropped from 5 to 4 on review. The original draft implied the
trust-boundary split was sufficient. It is not: it defeats instruction injection
completely and task steering not at all, and the honest score reflects that the
residual risk is contained by policy rather than eliminated by architecture.

Deliverability is the honest weak point. This PRD describes work that cannot
start until the Developer MCP has a working tool route and publication is
enabled. It is written now so that those components are built with this
consumer in mind, not retrofitted for it later.
