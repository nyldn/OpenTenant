# Custom domains

Status: local implementation and synthetic regression proofs. Hosting and TLS
activation have not been exercised against a provider. The three browser cases run in the
shared Playwright harness with synthetic tenants and injected DNS. See
[the browser guide](../tooling/e2e.md) for the production-rejected test composition.

## Owner and administrator flow

On the tenant's platform subdomain, open Settings → Domains. Add a DNS
subdomain such as `app.customer.test`. Apex names, IP literals, Unicode and
punycode labels, the installation's platform namespace and occupied or
overlapping custom domain names are rejected. Public and private suffixes are
interpreted by the MIT-licensed `tldts` dependency; no upstream code was copied.

Publish the shown value at `_opentenant-challenge.<host>` as a TXT record. The
256-bit random token is returned once in a no-store response. Only its SHA-256
hash is stored. Keep the TXT value in DNS after verification. A new challenge
expires after 24 hours; remove and re-add the domain if it expires or is lost.
Verify DNS to activate. A wrong, absent, or unavailable answer deactivates the
mapping. The add, verification decision and removal each commit atomically
with tenant-scoped audit evidence. Members, platform-only administrators and
managed support cannot mutate custom domains. Existing support-authorized
metadata editing remains separate.

The database's unique host key prevents duplicate claims. Registration also
serializes custom namespace claims, rejecting parent/child overlaps. Removal
and expired verification fail host lookup immediately; custom domains bypass
the platform-domain resolver cache. Apply forward migration
`0048_custom_domain_challenges.sql` before deploying the code. It deactivates
legacy custom records without challenge evidence. No `0049` migration is used.

## Reverification contract

`evaluateDomainVerification` in `@opentenant/domains/verification` is pure: it
accepts the stored challenge, observed TXT chunks and time. It returns the
verification state, activation, validity deadline and next check. It performs
no DNS, database, provider, clock or worker I/O. A later worker can call it;
no worker wiring is included. `verifyCustomDomain` accepts an injected
`TxtResolver`, checks the current challenge under a row lock, and applies the
result with an audit in one transaction. The HTTP composition uses Node's
resolver with a three-second timeout and one attempt. Tests supply a stub.

Successful verification schedules a recheck after 24 hours and expires routing
after 48 hours. Until a worker is wired, an administrator must reverify before
that deadline to keep the domain active. The retained hash supports subsequent
checks even after the initial enrollment window. A resolver error fails closed.

## Sign-in, sessions and connection OAuth

Cookies remain host-only, HttpOnly, Secure and SameSite=Lax where the identity
adapter sets them. No shared parent-domain cookie or OAuth code relay is added.
Middleware routes custom-domain identity and settings requests to a server
handler that verifies domain ownership and the canonical platform mapping.
It redirects GET requests to `https://<slug>.<OPENTENANT_TENANT_BASE_DOMAIN>`.
The sign-in return path stays on that platform origin after authentication;
public tenant pages remain accessible on the custom host. This is the safe
default while the owner chooses the callback topology noted in OWNER-TASKS.

Custom-domain callbacks discard code/state and restart sign-in or return to
platform connection settings. POST mutations on custom identity/settings
routes are refused; open platform settings before submitting them. Unknown,
expired or inactive hosts cannot choose a canonical redirect. Provider callback
registrations must target the platform subdomain; this change does not make a
single unrelated installation callback origin work for every tenant. The
owner's connection-OAuth topology decision remains open.

## Hosting boundary

`HostingDomainPort` is provider-neutral and independent of DNS proof. The Vercel
adapter prepares the documented `POST /v10/projects/{id}/domains` request, with
`{ name: host }`, but has no live mode and performs no network calls. It is
disabled unless its environment input contains `OPENTENANT_HOSTING_PROVIDER=vercel`,
`VERCEL_PROJECT_ID` and `VERCEL_TOKEN`. Supply that input only from server-side
environment configuration. Tokens never come from forms, tenant records or
returned plans. This adapter is not connected to registration, and does not
claim provider registration or certificate readiness. External enablement
requires a separate owner-authorized implementation and provider proof.

References: [Vercel REST API](https://vercel.com/docs/rest-api),
[tldts suffix parsing](https://github.com/remusao/tldts).

## Tenant tokens

The root layout applies the resolved brand's primary/background/foreground
colors and body/heading fonts as fixed CSS variable names on `<html>`, inherited
by every tenant page. Colors accept six-digit hex; fonts use a narrow family
list grammar. Invalid persisted values fall back before React serializes them.
There is no raw CSS or HTML interpolation. The brand policy's existing locking
and override precedence still apply.

Marketing impact: truth.
