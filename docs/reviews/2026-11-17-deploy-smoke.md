# One-command local deployment smoke, wave 7

Date: 2026-11-17. Revision: `642116e` (branch `t3/wave7`).
Command: `node scripts/smoke-deploy.mjs`, run in the foreground through
`forge-job` on the Linux development host (Docker Engine 29.1.3, Compose
2.40.3). This is the same command as the `deployment-smoke` CI job, which has
no hosted receipt because GitHub Actions is billing-blocked.

**Result: PASS, exit 0, 265 seconds wall time**, including both image builds.
The build fetched the pinned base image and public package dependencies. No
cloud provider, identity provider or model provider was contacted, and only
synthetic credentials were used.

Output, verbatim (the script prints no secrets or runtime details):

```text
Smoke project: opentenant-smoke-4170834-01c213f0; loopback ports app=3300, postgres=55435.
Smoke health: /api/health 200; migration completed before app startup; non-root image user verified.
Smoke tenant hosts: verified smoke.example.test 200; unknown.example.test and unknown.localhost 404; no tenant branding leaked.
Smoke migration: second run succeeded with the canonical checksum/lock runner.
Smoke PASS: local deployment only; no cloud calls or provider credentials.
Smoke cleanup: containers, network, database volume and tagged images removed.
```

What this establishes:
- Both the `runner` and `migrator` targets of `apps/platform/Dockerfile` build,
  and the app image runs as the non-root `node` user.
- `compose.production.yaml` starts healthy. Migrations complete before the app
  starts, and a second migration run succeeds through the checksum and lock
  runner.
- `/api/health` returns 200. A verified tenant subdomain loads. Unknown hosts
  return 404 without leaking tenant branding.
- Cleanup removes this run's containers, network, database volume and tagged
  images. No shared Docker state is pruned.

What it does not establish: hosted CI execution, a published deployment image
with provenance, or any production or hosted deployment. Those remain separate
CI and owner gates.

This is a receipt for the ECS Maturity criterion "Deployment reproducible with
one command" (`docs/reviews/2026-11-17-ecs-wave7.md`). The grade changes only
after an independent re-check.
