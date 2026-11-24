# ADR-006: Model selection, provider routing, and residency binding

Status: Accepted

Date: 2026-07-28

Decision owner: Chris

Supersedes: nothing. Partially answers `OWNER-AI-01`.

## Context

Three AI surfaces now exist or are accepted: the support agent
(`docs/product/ai-support-agent.md`), the knowledge assistant, and the
assessment module's optional model readout. Today the assessment module reaches
a provider through its own runtime config, and nothing else has a contract at
all. Left alone, each module will grow its own provider handling, its own key
storage, and its own idea of which region a request may leave.

The owner has decided two things:

1. Model provider is configurable across **OpenAI, Anthropic and OpenRouter**,
   and a tenant owner selects models **per module and per use case within a
   module**. Both the tenant admin and the installation owner need an interface
   for it.
2. **Data residency is managed through the Neon API**, with the admin
   experience built around the regions and database configurations Neon
   actually offers.

## Decision

### 1. Residency is derived from the data plane, never entered twice

The tenant's database region is the single source of truth. At provisioning,
the owner console reads available regions **live from the Neon API** rather than
from a hard-coded list, the operator picks one, and `tenants.data_region` is
**derived** from that choice rather than captured as a separate field.

The schema carries `data_region` on both the control plane and tenant core, and
`TenantDatabaseRecord.region` already holds the fine-grained provider region
such as `aws-us-east-1`. This ADR makes the coarse value a projection of the
fine one and forbids them from being set independently.

**The coarse vocabulary is `us`, `eu`, `ap`.** The existing check constraint
permits only `us` and `eu`; Neon serves Asia-Pacific regions
(`aws-ap-southeast-1`, `aws-ap-southeast-2`), so the vocabulary grows to include
them. This is a migration on two tables and is cheaper now than after tenant
data exists. Further Neon regions map into these three; the vocabulary grows
again only if a jurisdiction needs separating from its continent.

Neon regions are read, cached with a short TTL, and never hard-coded, so new
Neon regions appear in the console without a release. `azure_postgres` is
already a permitted provider in `TenantDatabaseRecord`; its regions map into the
same coarse vocabulary through the same derivation.

### 2. Residency constrains model routing. This is the part that is easy to miss

**A Neon region governs where the database sits. It does not govern where a
prompt goes.** A tenant whose data plane is in `aws-eu-central-1` and whose
ticket classification calls a US inference endpoint has no residency, and every
control in the data plane is irrelevant to that fact.

Therefore residency is not merely recorded, it is **enforced at model
selection**:

- every provider endpoint in the registry declares the coarse region it serves;
- the model allowlist offered to a tenant is **filtered by that tenant's
  `data_region`**, so a non-conforming model is not selectable rather than
  selectable-with-a-warning;
- the resolver re-checks residency at call time, because configuration can
  outlive the constraint that permitted it; and
- a residency mismatch **fails the call**. It does not silently fall back to a
  compliant model, because a silent substitution changes behaviour a tenant may
  have validated.

**OpenRouter needs specific handling.** It is a router: by default it forwards
to upstream providers in regions it chooses, which is precisely what a residency
constraint forbids. OpenRouter is therefore unavailable to a tenant with a
residency constraint **unless** the installation owner has pinned an explicit
provider and data-handling policy for it, recorded as part of the allowlist
entry. Convenience routing and residency are mutually exclusive; the console
must say so rather than let an operator discover it during an audit.

### 3. Three scopes, resolved in one cascade

The Engage platform solves the tenant-plus-use-case half of this well, and its
shape is adopted: a per-tenant config of categories, each holding `primary` and
`secondary` slots of `{provider, model}`, resolved through a cascade with a
system default at the end.

Two changes are needed for a multi-tenant installation:

- **An installation-owner ceiling.** The owner publishes an allowlist of
  `(provider, model, region)` entries. A tenant selects only within it. This is
  the multi-tenant admin control that Engage, being single-owner, has no need
  for.
- **Per module and per use case, not a flat category list.** The slot key is
  `(moduleId, useCase)`, because "the support module's triage call" and "the
  support module's reply draft" have different cost, latency and capability
  needs, and the accepted PRD in fact requires the triage model to be
  quarantined while the draft model is not.

Resolution order, first match wins:

```
(module, useCase) explicit
  → (module, default) explicit
    → (installation default for useCase)
      → (installation default)
        → platform default
```

Every step is filtered by the owner allowlist and by residency before it can
match. A resolution that ends with nothing is an error, never an implicit
platform default, because an unresolvable slot usually means the allowlist
changed under a tenant and that should surface.

### 4. Credentials stay brokered

Consistent with the existing platform rule that remote modules never receive
raw provider credentials: module code requests a completion through a
platform-owned client and never sees a key. Keys resolve tenant-first
(bring-your-own) then installation-fallback, and a tenant key is stored through
the existing `CredentialCipher` boundary rather than a new one.

A tenant using its own key changes the residency analysis, because the tenant
is then the controller of that relationship. The console records which key
resolved, and the allowlist filter still applies.

### 5. Every inference is attributable

The accepted evidence contract requires the real actor, a reason, and a policy
version. Model calls join it: each records tenant, module, use case, resolved
provider, resolved model, which key resolved, the coarse region served, and the
allowlist version in force. This is what lets an evidence export answer "which
model saw this ticket, and where did it run" without a log dive, and it is a
precondition for the support agent's T3 tier ever being defensible.

### 6. Two admin surfaces

**Installation owner** maintains the allowlist of `(provider, model, region)`,
sets an installation default per use case, sets the tenant ceiling, holds
fallback credentials, and sees per-tenant usage and spend. Adding a provider to
the allowlist is an audited change.

**Tenant admin** sees only what the ceiling permits, selects primary and
secondary per module and use case, optionally supplies their own key, and sees
their own usage. Residency-excluded models are shown as excluded **with the
reason**, rather than hidden, so an operator understands why a model they expect
is unavailable.

### 7. Cross-border consent

The tenant admin answers one question: **does this organisation accept its
ticket content being processed outside its data region?**

- **Yes** — out-of-region models become selectable within the owner allowlist.
- **No, and a compliant model exists** — the allowlist filters to in-region
  options. The common path.
- **No, and none exists** — the console offers provisioning in a region where a
  compliant model is available, from the regions the Neon API currently reports.

The answer is stored with who set it, when, and the `(provider, region)` pairs
it covers, so a later audit can see what was agreed rather than that something
was. Consent is revocable; on withdrawal, out-of-region slots stop resolving
rather than substituting an in-region model, and the console lists the slots
that will break before the change is confirmed.

Region choice is available at provisioning time only. Relocating an existing
tenant means moving its tickets, audit history, attachments and outbox, which is
a migration rather than a setting; see Consequences.

### 8. Retention posture is a first-class filter, not a footnote

Where a prompt is processed and whether it is retained afterwards are separate
questions, and a tenant can reasonably care about the second more than the
first. Every allowlist entry therefore declares a retention posture alongside
its region:

| Posture | Meaning |
| --- | --- |
| `zero_retention` | The owner holds a contract or approved endpoint configuration under which the provider does not persist prompt or completion content. |
| `provider_default` | Standard terms. Content may be retained for an abuse-monitoring window or longer. |
| `unverified` | Nobody has confirmed either way. |

**`unverified` is treated as `provider_default`, never as zero.** An unconfirmed
retention claim is an assumption, and this is exactly the kind of assumption
that reads fine until an auditor asks who verified it.

**Only the installation owner may set a posture.** Zero retention is a property
of a contract and an endpoint configuration, not of a preference. The owner is
the party who holds that contract, so a tenant can require zero retention but
cannot assert it. This mirrors how the residency allowlist already works.

The filter stack composes, applied in order and each able only to narrow:

```
owner allowlist
  → residency filter (tenant region, or explicit cross-border consent)
    → retention filter (owner ceiling, then tenant requirement)
      → resolvable slots
```

**Both admin surfaces get the control.** The installation owner can require
`zero_retention` across the whole installation, which removes non-conforming
entries for every tenant and is the right default for an installation serving
regulated customers. A tenant admin can require it for their own tenant,
narrowing further but never widening past the owner's ceiling.

**The empty-set case is the same one section 7 already handles.** A tenant that
declines cross-border processing *and* requires zero retention may find no model
satisfies both. That is not a new failure mode; it routes to the same branch,
which is to surface the conflict with its reason and offer the data-plane route
rather than silently resolving to something non-conforming.

**Retention posture joins the consent record and the inference record.** A
tenant consenting to cross-border processing is told the retention posture of
what they are consenting to, because "processed in the US" and "processed in the
US and retained for thirty days" are materially different disclosures to make to
their own customers. Each inference records the posture in force, so an evidence
export can answer whether a given ticket's content was retained anywhere.

## Consequences

Good: one contract instead of per-module drift; residency becomes enforceable
rather than documentary; the assessment module's ad hoc provider handling has
somewhere to migrate to; `OWNER-AI-01` is answerable on the provider axis.

Costs: the allowlist is a real operational surface that someone must maintain,
and getting it wrong makes models silently unavailable. Residency filtering will
surprise operators the first time it removes a model. OpenRouter's value is
largely convenience routing, and constraining it to pinned providers removes
much of that value for exactly the tenants most likely to care.

Deliberately not decided here: which models are on the initial allowlist, and
spend caps and rate limits per tenant.

## Open questions

1. **Resolved.** Residency is always constrained by the tenant's region; the
   escape hatch is explicit cross-border consent (section 7), not an
   unconstrained state. The `not null` check therefore stands as written and no
   sentinel is needed.
2. **Resolved.** The vocabulary is `us`, `eu`, `ap`, covering Neon's
   Asia-Pacific regions. Implemented as a migration against both tables.
3. **Resolved.** Retention is a first-class filter with its own posture per
   allowlist entry, settable by the owner and requirable by either admin
   surface (section 8). Unverified is treated as retaining. Training-data use is
   folded into the same posture rather than tracked separately, on the grounds
   that a zero-retention endpoint cannot train on what it does not keep; if a
   provider offers retention without training, that needs a fourth posture.
4. **Accepted as a limitation, not a question.** An existing tenant cannot be
   relocated between regions. The console says so; it does not offer a control
   that appears to do it. Should demand arise, migration is a backlog slice of
   its own with a cutover, a consistency window and re-encryption under a
   region-appropriate key.
