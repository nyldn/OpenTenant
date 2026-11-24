# Engineering-controllable score and delivery waves

Date: 2026-11-11. The landscape rubric in
[`../reviews/2026-11-11-full-review.md`](../reviews/2026-11-11-full-review.md)
stays as it is for comparing OpenTenant with other projects. That rubric caps
OpenTenant at 4.70 while the core is AGPL, and it needs maturity of about 4
(production users, contributors, time) before it can reach 4.8.

The agents iterate against the Engineering-Controllable Score (ECS) below.
They keep going until the ECS is at least **4.8** and no sub-score is below 4.

## Grading rules

- An independent reviewer with fresh context grades from evidence alone:
  commands, CI output, files and tests. The implementer's summary does not
  count as evidence.
- A sub-score cannot go above 4 until every R11 finding is closed with a
  regression test.
- To score 5, a sub-score must meet every criterion listed for it. Meeting
  some of them earns a proportional score.

## Sub-scores and the criteria for a 5

| Sub-score | Weight | Criteria for 5 |
| --- | --- | --- |
| Isolation | 20% | The RLS proof covers every tenant schema and uses the provisioning path's own migrations, with no SQL applied by hand. A freshly provisioned tenant passes e2e. A cross-tenant fuzz suite is green in CI. |
| Identity | 15% | An operator command bootstraps the owner with a single-use, expiring, audited invite. At least two identity adapters pass one shared conformance suite. R11-07 and R11-10 have regression tests. |
| Extensibility | 15% | `ModuleManifest` is the only module registry: no hard-coded native modules and no per-module `transpilePackages`. A third-party sample module installs without any change to core. |
| DX | 10% | `create-opentenant` gets from nothing to a running tenant in 10 minutes or less in a clean container, timed in CI. Configuration is typed. A lint rule enforces zero ad-hoc `process.env` reads outside the config module. |
| Maturity proxies | 20% | Changesets and semver are in place. Public packages are published with provenance. Adopter docs exist and CI checks their links. Every critical journey has e2e coverage. Deployment is reproducible with one command. SLOs are backed by a real readiness check, and a backup-restore drill is scripted. |
| AI | 5% | The Developer MCP has a callable route with tenant-scoped authorisation tests, kept behind its owner gate. Assessment and Brain are each either real or removed. |
| White-label | 5% | Per-tenant theming and custom-domain verification are both covered by e2e. |
| Audit | 10% | The audit head is anchored externally with signed checkpoints. `TRUNCATE` is blocked. A verifier CLI checks the chain against those checkpoints. |

## Owner track, separate from the ECS

- A licence decision. Moving the embeddable core to Apache-2.0 needs counsel
  and confirmation of sole copyright.
- A design-partner tenant in production.
- Public release.
- The production account, region and domains, plus backup RPO and RTO.

## Waves

| Wave | Mode | Work |
| --- | --- | --- |
| 0 | In flight | Security batch (merged), provisioning and ops batch, Playwright e2e harness |
| 1 | Serial for `apps/platform/lib` | Typed-config codemod (part of the ops batch). In parallel: audit anchoring and the `TRUNCATE` block, deployment definitions |
| 2 | Parallel, one owner per directory | Owner bootstrap; worker and helpdesk projection; observability; tenant lifecycle; rate limiting; key rotation; email; custom domains |
| 3 | Serial, under a freeze | Manifest registry, then package extraction. Moves use `git mv` only and change no behaviour |
| 4 | Parallel, one agent per package | Builds and publishing (tsdown, changesets, SQL shipped as assets); Better Auth adapter; `create-opentenant`; adopter docs; MCP route; white-label |
| 5 | Loop | Grade, fix, regrade until the ECS is at least 4.8 |

## Reuse policy

- Prefer a maintained dependency over copied code.
- Copy only from MIT, Apache-2.0, BSD, ISC or PostgreSQL-licensed sources.
  That keeps an Apache relicense possible.
- Treat AGPL, GPL, SSPL, BUSL, FSL, Elastic, source-available and unlicensed
  code as read-for-ideas only. The same applies to `ee/` or "Enterprise"
  folders inside otherwise open repositories.
- Every copied file keeps its original header and gets an entry in
  `THIRD_PARTY_NOTICES.md` with the source URL, commit SHA and licence. The
  pull request description names it as well.
- Agents must not reproduce code from memory when they cannot attribute it.
- A licence scan and an SBOM in CI fail the build on a violation.

## Vendor adoption: adopt the commodity layers

OpenTenant keeps its differentiated core. That covers tenant resolution, a
database per tenant with forced RLS, signed module context, the capability
broker, audited support, the hash-chained audit and the usage ledger.
Commodity layers become adapters behind provider-neutral ports. Each adapter
is optional, disabled unless configured, and covered by a conformance suite.

| Layer | Vendor (licence) | Port | Role |
| --- | --- | --- | --- |
| Identity, organisations, SSO, SCIM | Better Auth (MIT) | `IdentityGateway` | Default self-hosted identity, alongside WorkOS and Clerk |
| Fine-grained authorisation | OpenFGA (Apache-2.0) | `AuthorizationPort` | Optional relationship-based checks. The in-process role map stays the default |
| Usage metering to billing | OpenMeter (Apache-2.0) | `UsageExportSink` | The ledger stays the source of truth and exports CloudEvents. Billing stays owner-gated |
| Code sandboxes | E2B SDK (Apache-2.0); microsandbox (Apache-2.0) | sandbox provider contract | E2B is the hosted option and needs owner approval to run. microsandbox is the local, self-hosted option |

## Multi-agent tooling decisions

- **Adopt:**
  - A Harbor (Apache-2.0) evaluation built from completed backlog tasks. It
    scores the Codex, Claude and mini-swe-agent harnesses.
  - spec-kit (MIT) specs that feed `proposal.mjs`.
  - Disposable Postgres containers for verification. These replace the
    hand-built cluster in `tooling/unattended/src/postgres-proof.mjs`.
- **Keep:** the unattended runner's safety core, which no open-source tool
  matches: allowed paths, a trusted controller ref, contract immutability and
  a fail-closed review.
- **Avoid:**
  - GPT-Pilot (credential-stealing worm, unmaintained)
  - Roo Code (archived)
  - AutoGen (archived)
  - vibe-kanban (vendor shut down)
  - Taskmaster (Commons Clause)
  - ruflo (trust posture)
