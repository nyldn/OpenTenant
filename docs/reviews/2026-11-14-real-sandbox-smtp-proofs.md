# Real local microsandbox and SMTP proofs

Date: 2026-11-14. Base: `23200485fa09fc7418686b821b76ea2a75a2837d`.
Branch: `t3/real-sandbox-smtp-proofs`. Marketing impact: truth.

No push, PR or hosted provider operation was performed. All data was synthetic.
Only public npm and Docker registry downloads were used. The added CI jobs have
not run on GitHub. Hosted-runner KVM support still needs owner confirmation.

## Successful Docker proofs

`pnpm sandbox:microvm-proof` passes one required integration test, zero failed,
zero skipped. The latest run measured boot 0.447 s, test 1.245 s, total 3.906 s.
Earlier successful runs measured 0.506 / 1.306 / 3.840 s and
0.502 / 1.338 / 3.943 s respectively. Total includes container/image preparation
and cleanup; it is not a cold-cache download benchmark. The bundled SDK is
`microsandbox@0.7.13`, selected explicitly with the local backend.

Assertions executed against two real VMs:

- File write/read round-trip and successful structured command execution.
- Only fixed `HOME` and `PATH` appear in the command environment. The outer
  synthetic host canary does not appear.
- Only loopback and the kernel's dummy interface exist, with no IPv4/IPv6 route.
  BusyBox netcat is verified present before attempts to public `1.1.1.1:443`
  and a live random-port host listener both fail. A connection from the outer
  container to that listener succeeds first, so a missing listener cannot pass.
- A 4,096-byte command returns exactly 100 bytes and `outputTruncated=true`.
- A 30-second sleep with a 250 ms SDK deadline returns exit code `-1` and
  destroys its VM in 290.803 ms, including teardown, below the 10-second bound.
- Explicit termination of the first VM and deadline cleanup of the second each
  cause lookup by name to throw `SandboxNotFoundError`. The SDK list is empty,
  no runtime process remains, and `/proc` contains no open KVM VM/vCPU/device
  descriptors. A live descriptor is asserted while the VM is running.

Container flags are `--rm --init --name <unique> --label opentenant.proof=microvm
--network host --device /dev/kvm`, a read-only repository bind, a writable
report-directory bind, a working directory and explicit synthetic environment.
Root inside the container can open KVM without changing host group membership.
No privileged mode, added capabilities, tun, vhost-vsock or Docker socket is
used. Host networking makes the loopback-only host listener a valid control;
it does not give the NIC-disabled guest a route. The SDK image cache lives in
the disposable container. The bundled `msb image pull` fills it before the test;
VM creation uses `pullPolicy("never")`.

`pnpm smtp:proof` passes four tests, zero failed, zero skipped, in 18.612 s.
It starts Mailpit with `--rm -d --name <unique> --label opentenant.proof=smtp`,
random loopback SMTP/HTTP port bindings and synthetic SMTP-auth acceptance.
No relay is configured. PostgreSQL uses the canonical `pnpm db:ephemeral`
harness, canonical control-plane migrations and a fresh database.

Mailpit's HTTP API confirms recipient, subject, HTML/plain text support content,
plain-text Better Auth verification and persisted invitation URLs, and no
identity/SMTP secrets, passwords or body tokens in raw headers. Verification
follows the captured URL through the real Better Auth handler and checks the
persisted user is verified. Support uses the actual service and notification
transport, with one recorded delivered attempt. Invitation uses the actual
Better Auth gateway and notifications mail hooks. No transport/provider mock
is injected. Identity HTML is deliberately empty and asserted as such.

All proof containers have unique names, bounded subprocess deadlines, explicit
removal and the existing independent controller-death janitor. The launchers
assert Docker has no remaining container with their names. The host listener
is closed in `finally`; the database harness disposes its cluster and proxy.

## Immutable images

| Image | Pinned digest |
| --- | --- |
| `node:22-bookworm` | `sha256:e13726ca604184d7a91fcacab1fc09eefd642dc28e79ac34e85540dd93b78cfb` |
| `alpine:3.22.2` | `sha256:4b7ce07002c69e8f3d704a9c5d6fd3053be500b7f1c69fc0d80990c2ad8dd412` |
| `axllent/mailpit:v1.27.8` | `sha256:6abc8e633df15eaf785cfcf38bae48e66f64beecdc03121e249d0f9ec15f0707` |
| `pgvector/pgvector:0.8.2-pg17-bookworm` | `sha256:feb68f4f15446397d8cac7f4fe48fe4586de83160d1fc48b46283312d1a33966` |

Alpine's amd64 manifest is
`sha256:85f2b723e106c34644cd5851d7e81ee87da98ac54672b29947c052a45d31dc2f`.
Compose, CI and the local SMTP command use the same Mailpit digest. The local
command pre-pulls pinned pgvector, then tags that image with the canonical
harness tag. No package or lockfile dependency changed.

## Failed development attempts and retries

Failures remain failures; none is counted as passing evidence.

| Command / attempt | Passed / failed / skipped tests | Measurement and exact failure |
| --- | --- | --- |
| `pnpm sandbox:microvm-proof`, bridge attempt 1 | 0 / 0 / 0, launcher failed before tests | 3.939 s total; `Error: Host listener control timed out` |
| Same command, unchanged retry | 0 / 0 / 0, launcher failed before tests | 3.824 s total; `Error: Host listener control timed out` |
| Host-network attempt | 0 / 1 / 0 | Boot 0.411 s, total 2.964 s; adapter returned `Sandbox operation could not satisfy isolation policy`; runner also found `VM records remain` |
| Diagnostic boot rerun | 0 / 1 / 0 | Boot 0.319 s, total 2.430 s; same failure |
| Diagnostic stream rerun | 0 / 1 / 0 | Boot 0.360 s, total 2.714 s; native `RuntimeError: runtime error: exec session ended without exit event` |
| After adapter fixes | 0 / 1 / 0 | Boot 0.337 s, total 2.524 s; expected only `lo`, received `dummy0` and `lo` |
| After interface assertion correction | 0 / 1 / 0 | Boot 0.516 s, total 3.360 s; route command returned `exitCode: 127` because cleared PATH excludes `/sbin` |
| With explicit BusyBox route command | 0 / 1 / 0 | Boot 0.424 s, total 3.842 s; `promise resolved ... instead of rejecting`, actual timeout result `exitCode: -1` |
| `pnpm smtp:proof`, initial assertions | 1 / 3 / 0 | 17.675 s; SMTP uses CRLF, and React HTML inserts comments around interpolated text |
| SMTP after rendered-content normalization | 4 / 0 / 0 | 19.046 s total |

The bridge timeout was rerun once unchanged as requested. The SDK error was
fixed by retaining streamed exit codes instead of waiting after draining.
Teardown now uses `destroy({ force: true, timeoutMs: 10000 })`; killing alone
retained the VM record. A regression test makes `wait()` fail if called after
the mock stream has yielded its exit event and checks destroy options.
The invalid command-path and timeout-result assertions were corrected to match
the real guest, without weakening the isolation assertions.

## Verification inventory

Each test launcher was run under a named `forge-job run` unit. The final
commands and their counts are:

| Exact command | Result |
| --- | --- |
| `pnpm sandbox:microvm-proof` | PASS, 1 passed, 0 failed, 0 skipped; latest total 3.906 s |
| `pnpm smtp:proof` | PASS, 4 passed, 0 failed, 0 skipped; latest total 18.612 s |
| `pnpm --filter @opentenant/sandbox test` | 147 passed, 0 failed, 1 optional real-VM test skipped; separately executed above |
| `pnpm --filter @opentenant/notifications test` | 10 passed, 0 failed, 1 optional Mailpit test skipped; separately executed above |
| `pnpm turbo typecheck lint test --concurrency=2` | PASS, 112 tasks; 1,902 passed, 0 failed, 78 skipped |
| `pnpm exec eslint tooling/proofs/*.mjs` | PASS |
| `git diff --check 2320048 HEAD` | Run after commit; result in handoff |

The first full gate passed 112 tasks in 2m13.655s. It reported 1,901 passed,
zero failed and 78 skipped tests, including cached package output. The final
gate passed 112 tasks in 1m16.195s with 1,902 passed, zero failed and 78 skipped
tests, including the added regression test. Optional
integration skips in general package commands are not live proof. The two
required Docker commands above execute their own cases with zero skips.
The platform build also ran successfully as a dependency of the full gate.

Security and tooling checks:

- `pnpm audit --prod --audit-level high` passes with no high findings, reporting
  one low and five moderate findings. No dependencies were added.
- `semgrep scan --config packages/auth-better-auth/semgrep.yml --metrics=off
  --disable-version-check --error .` runs the two local rules across 891 files with zero findings.
  The first attempted `.semgrep` path failed because it does not exist; the
  repository's actual local rules were then used. No remote rules downloaded.
- Offline `trivy fs` with cached DB/checks, version/DB updates disabled and
  generated dependency/build directories excluded reports three medium
  findings, zero high/critical and zero Dockerfile misconfigurations. An initial
  broader scan also traversed third-party `node_modules` Dockerfiles; those
  findings do not describe this change.
- Broad filesystem `gitleaks dir .` found generated `.next`, `dist` and graph
  matches. Metadata inspection found no source-file findings. The staged
  source scan passed with zero leaks across 47.31 KB; commit scanning is also
  reported at handoff.
- `ripwire packages/sandbox --quality-delta` has zero gating regressions and one
  minor complexity increase in `createLocal`, 17 to 20. Its edit-check reports
  the existing function contract unchanged. The extra branches retain streamed
  exit status and reject a missing exit event; no public contract changed.
- `graphify update .` completed. Generated graph files stay uncommitted.
- No `.pre-commit-config.yaml` exists. No prompt/agent behavior changed.
- `forge-job audit` before and after work reports no unmanaged dev servers.
