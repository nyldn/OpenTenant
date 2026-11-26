# Local tenant demo and module bindings verification

The local demo adopts a tenant-first setup flow. It reuses the UAT launcher,
Better Auth fixtures, PostgreSQL provisioner, canonical migrations, and durable
tenant worker. Its private sign-in link opens Support on the Alpha tenant.
The tenant databases are disposable and stay available for the life of the demo.

The native module changes adopt explicit installation dependencies. Brain and
Support register their own API handlers. The platform supplies typed bindings
and retains the existing module order and policy checks. Default module exports
remain available to adopters.

These changes use ideas from [Frappe site creation](https://docs.frappe.io/framework/user/en/bench/reference/new-site)
and [Medusa module isolation](https://docs.medusajs.com/learn/fundamentals/modules/isolation).

## Verification

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed in a fresh clone with 23 workspace builds. |
| `pnpm quality:matrix` | Passed. |
| `pnpm check` | Passed, 115/115 tasks. The platform suite recorded 708 passing and 36 skipped tests. |
| `pnpm build` | Passed, including the Next.js platform. |
| `pnpm module:audit` | Passed with zero special cases. |
| `pnpm module:adopter-proof` | Passed three tests for packed module installation, route and navigation registration, entitlement denial, migrations, and no host core edits. |
| `pnpm --filter @opentenant/uat test` | Passed 40 tests with no skips. |
| `pnpm docs:links`, Git diff, and privacy checks | Passed. |
| Gitleaks, repository Semgrep rules, and offline Trivy | No findings at the configured scan thresholds. |

The Playwright proof used real local PostgreSQL and Better Auth. At widths
1280 px and 390 px, the demo shortcut opened Support, a keyboard submission
created a ticket, and reload showed the saved ticket. The Beta tenant could
see its own queue and received HTTP 404 for the Alpha ticket URL. The launcher
also refused app dotenv files and a second launch in the same checkout.
The demo command and both browser cases took 124 seconds after dependency
installation on this run.

The proof used cached PostgreSQL and Mailpit images. It verified credential
file permissions, disposable resources, and loopback access. Hosted CI is
separate from these local results.
