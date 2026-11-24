# OpenTenant owner tasks

## Evidence reconciliation, 2026-11-17

The [E11 receipt ledger](plans/2026-11-17-e11-reconciliation.md) separates
local proofs from pending owner decisions. The Nov 17 real Developer MCP route
proof supersedes the old missing-local-VM summary. It clears no production,
publication or counsel gate. Marketing impact: none.

## OWNER-KVM-CI-01: Confirm hosted runner KVM support

The new `microvm-proof` CI job uses an Ubuntu-hosted runner, a KVM udev rule
and a digest-pinned Node 22 container with `/dev/kvm`. The local Docker proof
passes, including the later actual Developer MCP route composition. GitHub
Actions is billing-blocked, so there are no hosted CI receipts for these waves.
See the [V1 verification limits](../tooling/ci/db-sequence-inventory.md).
Confirm an approved runner
exposes working KVM before treating the job as CI evidence. Keep missing KVM
a failure. See [the proof record](reviews/2026-11-14-real-sandbox-smtp-proofs.md).
This does not approve production sandbox or Developer MCP activation.

No owner action blocks local development.

## Public package release

- [ ] `OWNER-NPM-RELEASE-01`: approve the public npm namespace, first fixed 0.x
      release, public source visibility for provenance, npm trusted publishing
      and the protected `npm-release` environment. Set the repository variable
      `OWNER_NPM_RELEASE_ENABLED=true` only after that approval.
      Review package, licence, SBOM and provenance evidence before dispatching
      `.github/workflows/release.yml` with `dry_run: false`. Enabling automatic
      triggers is a separate owner decision. Default dispatch performs a dry run.

## Current governed backlog gates

All 53 non-owner backlog tasks are completed and independently verified, and
the autonomous queue is empty. These are the only four pending owner-controlled
backlog entries;
each stays pending until the owner
supplies the named external scope or product decision:

- [ ] `OWNER-SLACK-01` — nominate the development workspace/channel and approve
      the exact synthetic Slack probe and cleanup boundary.
- [ ] `OWNER-DEVELOPER-MCP-02` — approve production activation of the exact
      callable Developer MCP route after reviewing its protected-resource,
      sandbox, admission, preview, confirmation and kill-switch evidence.
      Local OAuth/browser and database proofs are integrated; the
      [Nov 17 route receipt](reviews/2026-11-17-developer-mcp-route.json)
      also proves real local VM execution/destruction and negative controls.
      The production owner decision and hosted CI evidence remain open.
- [ ] `OWNER-COMPLIANCE-01` — select the legal/system boundary, criteria,
      ownership, evidence period, and provider scope for SOC 2 and Vanta.
- [ ] `OWNER-BILLING-01` — freeze billable metric definitions, replay and
      correction semantics, commercial entitlement policy, and payment-provider
      scope. The implemented exact-usage ledger makes no billing decision.

The longer checklists below remain release, provider, or production gates.
They do not imply hidden autonomous tasks and do not authorize genuine tenant
data or production changes. The 53-task statement applies to the legacy
controller ledger, not completion of the later UX wave plan.

## GitHub protections unavailable on the current plan

- [x] Enable the available repository protections: template mode, web commit
      signoff, merged-branch deletion, dependency alerts/security updates,
      curated Actions, and read-only default workflow permissions.
- [ ] Before public contributions or production releases, either make the
      repository public or upgrade the user-owned private repository to a plan
      that supports branch protection/rulesets. Then require pull requests,
      strict `check` and `rls-proof` status checks, conversation resolution,
      and blocked force-push/deletion on `main`. GitHub currently returns HTTP
      403 for both protection APIs.
- [ ] Enable GitHub repository secret scanning and push protection when the
      repository visibility or plan makes them available. GitHub currently
      returns HTTP 422; the pinned Gitleaks CI scan remains the local gate.
- [ ] Before enabling a scheduled GitHub-hosted coding agent, provide branch or
      ruleset protection and approve a pinned Public Preview toolchain whose
      agent job is read-only and secret-free and whose PR-only output is applied
      by a separate short-lived, minimal-permission job. The local unattended
      runner and normal CI do not require this decision.

## If a tenant migration reports multiple identity anchors

- [ ] Freeze writes and create a verified snapshot or isolated clone of the
      affected tenant database.
- [ ] Privately identify the authoritative tenant and disposition of every
      conflicting identity using control-plane, provider, backup, and module-row
      evidence. Do not paste tenant identifiers into repository artifacts.
- [ ] Approve a database-specific repair and rollback point after it passes on
      the isolated clone. Follow
      [the recovery runbook](runbooks/tenant-anchor-recovery.md); OpenTenant will
      not select or delete an ambiguous tenant automatically.

## Settled provider direction

- [x] Use either WorkOS or Clerk per installation for hosted identity and
      authorization, Vercel for application hosting and hosted sandbox
      execution, and Neon PostgreSQL for the hosted control and tenant data
      planes.
- [x] Preserve provider-neutral application contracts and local development
      adapters; the provider decision does not permit hard-coded resource IDs
      or direct provider contracts in modules.

## Complete provider credential cleanup

- [ ] Confirm whether any other application uses the old provider API tokens,
      then rotate or revoke them in Vercel, WorkOS, and Neon as appropriate.
- [ ] After that review, permanently empty the recoverable legacy provider
      environment backup currently held in the local Trash.
- [ ] Do not delete shared WorkOS organisations unless each is proved exclusive
      to the retired application.

## Before making the repository public

- [x] Adopt `AGPL-3.0-only` for the core, `Apache-2.0` for the module
      SDK, and `CC-BY-SA-4.0` for documentation.
- [x] Use a dual-licensing model: open-source AGPL terms by default and
      separately negotiated commercial terms where required.
- [ ] Name and verify the legal copyright, commercial-licensing, and trademark
      steward, then have qualified counsel review the complete licence package.
- [x] Complete the repository-level technical provenance and third-party
      dependency licence review for the current macOS arm64 closure.
- [ ] Attest that the pre-import source, assessment content, copy, and retained
      SVG marks were authored by or validly assigned/licensed to the steward.
- [ ] Generate and verify licence texts, notices, source/relinking material, and
      an SBOM against each actual release artifact and supported platform.
- [ ] Approve the contributor licence agreement, `SECURITY.md`, code of
      conduct, and final trademark-clearance position before accepting public
      contributions.
- [ ] Approve a fresh GitHub destination for the independently verified clean
  checkout. Keep the development archive private. Confirm the destination has
  no inherited pull requests, Actions records, or private refs.
- [ ] Require the Repository privacy check and maintainer review. Enable secret
  scanning and push protection when the destination supports them.
- [ ] Approve the private vulnerability reporting channel in SECURITY.md and
  complete the final source and fixture provenance review.

## Before hosted testing

- [x] Supply ignored development credentials for the nominated Vercel and Neon
      environments and authorize bounded non-production testing throughout
      development.
- [x] Attest that the fresh WorkOS account is dedicated to OpenTenant
      development; sanitized API inventory observed no users but did not
      independently prove the provenance of pre-existing provider objects.
- [x] Use Neon's existing free plan with zero incremental spend for bounded
      development probes, and use the US region (`aws-us-east-1`) for the
      approved test tenant. Expansion to other regions remains separate.
- [ ] Set a maximum incremental spend and approved region where applicable for
      any Vercel or WorkOS operation beyond the already approved probes.
- [x] Supply an ignored Vercel token/team scope and approve one minimal
      ephemeral sandbox probe. The project was deleted after the test.
- [x] Supply Neon development credentials through the ignored local `.env`.
- [x] Supply a WorkOS API key and client ID through the ignored local `.env`.
- [x] Supply a fresh development-only Clerk application and CLI/API credentials.
- [x] Configure and verify the demo Clerk session-token audience claim without
      creating a user, organization, membership, domain, or production setting.
- [ ] Approve the exact Clerk System Permissions for `org:tenant_owner` and
      `org:tenant_admin`, then add both roles to the Primary Role Set, set owner
      as creator and `org:member` as default, and enable Organizations. Clerk
      requires creator-role organization-management permissions; the repository
      deliberately does not invent whether tenant admins may delete the
      organization. Brand proposal writes additionally require the distinct
      permissions `org:brand:proposal:upload`, `org:brand:proposal:review`,
      `org:brand:proposal:edit`, `org:brand:proposal:apply`,
      `org:brand:proposal:supersede`, and `org:brand:proposal:revoke`; grant
      only the operations each tenant role should perform. After this decision,
      rerun browser signup, active-org tenant
      binding, member administration, sign-out, and complete synthetic cleanup.
- [x] Configure the ignored `WORKOS_COOKIE_PASSWORD` and local
      `WORKOS_REDIRECT_URI`, register the matching development callback, and
      verify the minimum AuthKit login/error-path behavior.
- [x] Verify the successful hosted AuthKit callback, sealed cookie, active
      `tenant-owner` membership, and local tenant binding with temporary
      synthetic objects, then prove complete cleanup.
- [x] Permit an owner-controlled domain as the development test-tenant identity
      and synthetic-data boundary. This does not authorize importing genuine
      site data or changing the domain's existing DNS/hosting.
- [x] Permit a separate owner-controlled namespace for hosted OpenTenant
      testing. Its live apex must not be reassigned; choose
      and configure a dedicated OpenTenant subdomain before activation.
- [ ] Approve any operation outside bounded development testing. No production
      account, team, project, organisation, or paid capacity is selected; the
      development region and domain-namespace approvals above do not authorize
      production enablement.
- [ ] Approve Vercel Sandbox for production only after its capability,
      preview-auth, isolation, retention, cost, region, and deletion probe.

## Deferred from the 2026-09-29 repository review

- [ ] Choose the anonymous passcode rate-limit design. All anonymous attempts
      for a tenant share one bucket of 10 per minute, so anyone can lock out
      legitimate passcode users. Keying by client weakens brute-force
      protection unless a trusted proxy supplies client addresses.
- [ ] Choose a separate origin for remote modules. Proxied module responses now
      run in an opaque sandbox, so module scripts, fonts, and gated assets fail
      to load until modules have their own origin.
- [ ] Choose the OAuth connection callback topology. Providers redirect to
      `PLATFORM_PUBLIC_ORIGIN`, but the callback resolves the tenant from the
      host and needs the host-only admin session, so connections fail for any
      tenant whose domain differs. Relaying the code to a tenant domain is
      unsafe because the tenant controls that domain's DNS. Viable options are
      per-tenant registered redirect URIs or a shared parent-domain session.
- [ ] Move `tenant_app` password rotation to Neon's role password-reset API.
      Neon rejects precomputed SCRAM verifiers, so the password still appears in
      `create role` / `alter role` statement text on the provider.
- [ ] Decide whether the Archify updater keeps committing locally to `main` or
      writes to a review branch instead.

## Before genuine tenant data

- [ ] Approve production identity configuration and login-abuse protection.
      Before production use, provision independent `MODULE_ACCESS_SECRET` and
      `CONNECTIONS_STATE_SECRET` keys; cookie secrets no longer supply either
      production HMAC purpose.
- [ ] Approve data region, retention, point-in-time restore, backup export,
      incident response, and deletion evidence.
- [ ] Complete the cross-tenant isolation and restore exercises.
- [ ] Approve public origins and OAuth callback registrations.
- [ ] Approve production sandbox isolation and authenticated preview design.

## Before hosted Slack support or Vanta testing

- [ ] For Slack support, nominate a development-only workspace and channel,
      approve whether the first probe may create an incoming webhook or requires
      an existing webhook, and confirm that synthetic ticket metadata may be
      delivered there. This is not needed for the local outbox/adapter slices.
- [ ] Before Slack OAuth/interactivity, approve the exact app scopes, workspace,
      redirect origin, signing-secret custody, test-user mapping, and cleanup
      boundary. Do not reuse the knowledge-ingestion Slack connection merely
      because it already exists. OPS-10's provider-independent synthetic
      contracts require none of these approvals and do not satisfy this gate.
- [ ] Before a Vanta probe, provide or nominate a development/sandbox account,
      confirm API/plan availability and region, choose installation-owner or
      tenant scope, and approve the exact synthetic resources/evidence that may
      leave OpenTenant. Local evidence contracts do not require Vanta access.
- [ ] Treat SOC 2 readiness as an organisational programme: select the legal
      entity, system boundary, Trust Services Criteria, control owners, auditor,
      evidence period, and policies before making any compliance claim.

## Before support AI assistance

- [x] Accept the provider-neutral routing, residency, cross-border-consent, and
      retention contract in ADR-006. OPS-13 implements the local synthetic
      contract only; this does not select or approve a live provider.
- [ ] After deterministic support, privacy, and evidence slices pass, choose
      the first model provider and region and approve that provider's exact
      development-only processing posture. The ticket fields, attachment
      exclusion, retention, and redaction boundary are already frozen; no live
      call is authorised by the local contract.
- [x] Freeze installation-owner shared and tenant-private knowledge scopes,
      provenance/publication rules, offline evaluation thresholds, required
      human review, and prohibited automatic actions in
      `docs/product/support-ai-boundary.md` (`OWNER-AI-01`). OPS-12 implements
      the local synthetic contract; no model-backed ticket content may leave
      that boundary until the provider task above is completed.

## Open Developer MCP decisions

- [x] Support Vercel's official MCP as an optional operator-only diagnostic
      integration for deployment inventory, logs, approved protected previews,
      and toolbar feedback. It does not replace OpenTenant's tenant-bound
      Developer MCP or reach tenant users/generated code. Provider mutations
      remain owner-gated, every MCP call requires human confirmation, and
      unattended CLI, deployment, domain, and purchase tools are prohibited.
      See the [operator runbook](runbooks/vercel-operator-mcp.md).

- [x] **OpenTenant-managed repositories only**, decided 2026-08-03. Tenant-owned
      Git is a later source adapter, not a v1 path. No tenant Git credential is
      brokered and no third-party host is reached, which is what keeps the
      sandbox egress work bounded.
- [x] **Per-tenant policy, configured by the installation owner**, decided
      2026-08-03. The owner selects one mode per tenant from a closed set:
      `always`, `on_sensitive_capability`, `first_publication_only`.

      Three sub-decisions resolved fail-closed on 2026-08-03 because the
      answer implies them and the strict reading is the safe one. Reverse any
      of them explicitly if that is not the intent.

      1. **Default is `always`.** A tenant with no explicit setting requires a
         second approver. Absence of configuration must never be the permissive
         case.
      2. **The installation owner alone may set it.** A tenant admin who could
         set their own mode could set `first_publication_only` and approve their
         own subsequent publications, which is self-approval with extra steps.
      3. **Changes are audited as authority changes**, not as settings edits,
         and the audit record for a publication carries the mode that
         authorized it. Otherwise a later reader cannot tell whether a
         single-approver publication was legitimate.

      `TM-010` closure requires conformance tests per mode, not one test: two
      modes in v1, three if `on_sensitive_capability` is ever added.
- [x] **Only the two frozen profiles ship**, decided 2026-08-03:
      `developer.readonly@1` and `developer.builder@1`, each mapped to a stable
      IdP group identifier. Trusted builder, publisher and capability
      administrator are deferred until a named user needs one.

      Consequence worth stating: `developer.builder@1` holds no `publish` slug,
      so **nothing can publish in v1**. The second-approver policy above is
      therefore designed and configurable but unreachable until a publisher
      profile exists. That is coherent, and it means the publication work is
      design-now, build-later.
- [x] Freeze the initial Developer MCP permission slugs and versioned
      tool/resource schemas before any successful tool route is exposed.
- [x] Approve the initial server-owned template registry identifiers and
      versions; external callers must not supply template bytes or approval
      digests. The v1 registry is limited to
      `opentenant/module-ui-next@1` and `opentenant/module-service@1`; neither is
      exposed through a Developer MCP route yet.
- [x] Developer eligibility grants no profile automatically; every profile is
      an explicit assignment.
- [x] Set the maximum stale-authority window to 60 seconds and require a
      synchronous revocation check for high-risk calls.
- [x] Launch resource-specific authorization behind a provider-neutral local
      adapter with a documented WorkOS FGA migration path.
- [x] **None in v1**, decided 2026-08-03. Modules reach tenant data through
      the platform and broker no external API.

      This is the decision that de-blocks the release: with no legitimate
      egress, the unfixed DNS-rebinding hole in the sandbox stops being
      release-blocking. It does **not** become acceptable. The sandbox still
      claims a deny-all posture that connect-time address checking does not
      enforce, and that claim is still false; it is simply no longer in the
      path of a shipping feature. Brokering is its own gated project and its
      first criterion is closing that hole.

## Marketing workspace

- [ ] To use premium Shadcn Studio resources, add the purchasing account's
      `EMAIL` and `LICENSE_KEY` to the separate marketing repository's ignored
      `.env`. Those variable names are not present in OpenTenant's current
      `.env`; do not copy the complete provider credential file across. The
      current marketing baseline uses one materially modified free Studio
      component and requires no premium credential.
- [ ] Add a read-only `OPENTENANT_READ_TOKEN` to the separate marketing
      repository and manually verify its prepared **Product truth drift**
      workflow if GitHub-hosted weekly drift checks are wanted. The local
      post-merge sync route does not require this token.
- [ ] If immediate merge-triggered cross-repository notification is wanted,
      approve a least-privilege GitHub App or narrowly scoped repository token
      and the exact `opentenant-product-change` dispatch workflow. Do not reuse
      a broad personal token or allow the notification to write marketing copy,
      acknowledge claims, merge, or deploy.

## Deferred Module Improvement Lab decisions

- [ ] Choose the first quality-contract outcomes and structured signal types.
- [ ] Set minimum evidence and confidence thresholds for proposals.
- [ ] Select experiment allocation, traffic, duration, spend, guardrail, and
      automatic rollback defaults.
- [ ] Decide whether cross-tenant benchmark-pattern sharing is valuable enough
      to justify a separate opt-in governance surface.
