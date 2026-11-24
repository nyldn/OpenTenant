# Persistent local UAT

Use Node 22, pnpm 11.13.1, Docker, and the installed workspace dependencies.
Load `pgvector/pgvector:0.8.2-pg17-bookworm` and
`axllent/mailpit:v1.27.8` into Docker first. The runner never pulls images.
All accounts and content are synthetic. Use the exact image pull commands in
[the E2E prerequisites](e2e.md) so the cached image digests match the harness.

```sh
pnpm install --frozen-lockfile
pnpm uat:start
pnpm uat:status
```

`uat:start` requires tmux and starts the named `opentenant-uat` session with an
8-hour TTL. A second instance is rejected, including across worktrees sharing
the tmux server. On Forge, the tmux command runs its foreground supervisor under
`forge-job run --seconds 28920`; the watchdog invokes `uat:down` at eight hours.
The extra two minutes bound cleanup. No automatic restart occurs. A 30-minute
warning goes to the tmux console. Attach with `tmux attach -t opentenant-uat`
to inspect the console, then detach without stopping the service. `uat:status` prints running/stopped, remaining
seconds and loopback ports without credentials. Startup prints only the private
manifest path. `.uat/service.log` and `.uat/manifest.json` are mode 0600.

Startup runs canonical migrations and provisions seven separate tenant databases
through the production Postgres provisioner and Graphile worker. The standard
service uses Better Auth. `pnpm uat:serve` remains a foreground local-identity
command; use `--better-auth` for the real synthetic identity fixture. All app,
Mailpit, SMTP, DNS and internal listeners bind to loopback. The Postgres harness
uses a local socket/loopback relay and validates the pinned image digest.

Open the manifest's `signInUrl` for the desired persona. It sets an HttpOnly,
host-only `opentenant_session` cookie in dev mode. Built mode uses a Secure
`__Secure-opentenant_session` cookie on the browser-trusted localhost origin. The manifest also documents the exact
cookie for automation. Tokens change on every launch. There is no shared
password or production sign-in bypass. Keep the manifest private; `.uat/` is
ignored and files have mode 0600.

| Tenant | Content |
| --- | --- |
| workspace | Installation owner's workspace, tickets and Assessment |
| alpha | Every tenant role, five ticket states, Assessment in progress, brand proposal draft, managed support enabled |
| beta | Different branding, tickets and Assessment |
| hostile | Persisted hostile branding strings from the e2e fixtures |
| fresh | Provisioned schemas and owner, with no journey content |
| pending | Unclaimed owner invite, delivered to Mailpit and the run's private invite directory |
| suspended | Provisioned tenant blocked by the lifecycle gate |

The manifest includes installation owner, tenant owners, tenant admin, tenant
member, managed-support operator and a user with no memberships. The support
operator has installation authority but no tenant membership. Its Alpha
sign-in opens `/admin/support`; start a support session with a reason and
reference there. To carry installation authority to another tenant host, change
only the hostname in that persona's sign-in URL. Normal tenant credentials
still enforce their exact tenant binding.

Assessment persists in browser localStorage. `pnpm uat:reset` stops the app and
worker, restores the private post-seed database snapshots, removes test-created
databases/roles and restores seeded Mailpit invitations through loopback SMTP,
then restarts the app/worker. It verifies
restored row data against the seed before accepting the reset. This restores
access policies, branding, navigation, module presentation, memberships/invites,
support sessions, tickets, lifecycle, jobs, tenants and domains together.

After reset, close old test pages and reopen each private persona link. Its new
fixture revision clears Assessment keys only in that test origin and reinstalls
the initial engagement. Fresh stays empty. Signing in again without a reset
preserves edits. Other browser origins remain untouched. Export reproduction
data privately before resetting. A failed restore stops the service and reports
failure; it is never a successful compensation.

`uat-reset.spec.ts` changes fixtures, proves the live reset, checks Assessment
identity/passcode behavior and browser storage, restarts with new credentials,
and rejects an old sign-in token. This is separate from the historical BrowserOS
run, whose final reset was not executed before expiry.

For the provisioning retry journey, `pnpm uat:control fail-next-provision`
creates a local migration-table conflict for the new `uat-provision-retry`
slug. Check `pnpm uat:control status`, wait for failed provisioning, run
`pnpm uat:control clear`, then use the product's Retry job action. For export
expiry, create and download an export, run
`pnpm uat:control expire-exports <tenant-slug>`, and retry the same URL for 404.
Both controls require this worktree's running disposable loopback stack and
refuse service Postgres. They change UAT fixture state without changing product
code. See [operator controls](../../tooling/uat/README.md) for guards and commands.

Dev personas use `LOCAL_USERS`. The local identity adapter supports role and
membership reads; invitation, removal and role-change mutations require a real
organization adapter. Use the same stack with the real synthetic Better Auth
accounts to exercise invitation, membership mutation and identity form journeys:

```sh
pnpm uat:serve --better-auth
```

The default mode still uses `LOCAL_USERS`. Better Auth mode uses the same
persona links and signed database cookies. For a compiled server:

```sh
pnpm uat:serve --start --build
# Or reuse an existing production build:
pnpm uat:serve --start
```

This runs `next start` with Better Auth and the same seeded users and roles,
using signed database sessions through the UAT sign-in helper. Production
identity forms still require HTTPS, including sign-out. Over this HTTP tunnel,
use the UAT persona links to switch sessions; the helper never relaxes the
production identity gates. Neither
`LOCAL_USERS` nor `OPENTENANT_E2E` reaches the production app. Their existing
production rejection remains enforced. Built mode uses the normal DNS resolver;
the dev DNS stub is available at the manifest's loopback DNS port. Configure a
synthetic TXT answer there for a domain journey, as described in [e2e.md](e2e.md).
No model or hosted provider credentials are inherited. Journeys that require
those services show their normal unconfigured state.

## Remote browser over SSH

Copy the exact `ssh.command` from the manifest, replacing `USER@HOST`. Example:

```sh
ssh -N -L 31001:127.0.0.1:31001 -L 31002:127.0.0.1:31002 USER@HOST
```

Open the printed `http://alpha.localhost:31001/` or a persona sign-in URL on
your own machine. Modern browsers resolve `*.localhost` to their own loopback,
which the tunnel forwards to the server. Keep the same local and remote port
numbers so Host and origin checks agree. Mailpit is at
`http://127.0.0.1:31002`. Only the app and Mailpit UI need forwarding; database,
SMTP, Next's internal listener, module stub and DNS control remain server-local. For curl,
use `--resolve alpha.localhost:31001:127.0.0.1` if the local resolver lacks
wildcard localhost support. Do not publish Docker ports or bind to external
interfaces. All host listeners bind explicitly to `127.0.0.1`.

## Shutdown and verification

Ctrl-C or SIGTERM stops the app, worker and controls, removes both containers
and their volumes, and deletes the manifest. After a crash, use the workspace
label to remove orphans:

```sh
pnpm uat:down
node --test tooling/uat/runtime.test.mjs
# Against a running stack:
node tooling/uat/probe.mjs
node tooling/uat/browser-proof.mjs
```

`uat:down` first asks a live controller to shut down, then removes only UAT
containers labeled for this worktree. It does not prune other Docker resources.
On Linux, a parent-death guardian also stops run-owned child process groups
and removes containers after an abrupt launcher exit. It verifies process
start times before signaling, so recycled PIDs are excluded. A second launcher
in the same worktree fails instead of overwriting a manifest.

See the [verification record](uat-verification-2026-11-14.md) and
[complete synthetic manifest example](uat-manifest.example.json).

## BrowserOS runbook

Use the [15-journey BrowserOS procedure](../plans/2026-11-15-ux-fix-plan.md#browseros-neo-runbook-on-the-owners-mac)
on the owner's Mac, with an agent-owned tab group and only the manifest's app
and Mailpit SSH forwards. Keep tokens and invitation links out of findings.
Run `uat:reset` between mutating runs and reopen persona links before checking
the seed. Stop with `uat:down`, run it again to check idempotence, then verify the
tmux session, workspace-labeled containers, manifest and recorded listeners are
gone. The [tracked audit contract](../../tooling/e2e/audit/README.md) explains
automated coverage and its limits. A passing baseline comparison is not UAT pass.
