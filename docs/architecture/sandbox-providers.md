# Sandbox providers

The provider-neutral `SandboxAdapter` contract stays in `packages/sandbox`.
SDK imports live in adapter composition roots. New adapters are optional and
disabled until the installation explicitly selects them. No hosted sandbox was
started for this implementation.

| Provider | Evidence | Execution limits | Network | Preview |
| --- | --- | --- | --- | --- |
| Vercel | Injected transport tests | CPU and duration mapped; memory enforcement unproved | Provider boundary maps deny-all and allowlists | Requires authenticated mediator |
| sandboxd | Mock HTTP feasibility tests | Resource controls and structured commands unsupported | Policy enforcement unsupported | Existing private preview boundary |
| E2B | Mock SDK tests | Approved template CPU/memory, verified by readback; duration and command deadlines | Deny-all only; creation refuses missing IPv4/IPv6 deny controls | Private upstream plus an expiring authenticated mediator |
| microsandbox | Mock SDK tests plus real Docker/KVM lifecycle and isolation proof on 2026-11-14 | Native CPU/memory maxima, maximum duration, command timeout | NIC disabled; allowlists refused | Unsupported with this adapter's no-network configuration |

All four run the shared capability-aware conformance suite. Unsupported
operations must reject explicitly. Passing these tests with mocks establishes
adapter behavior, not live provider isolation. The module proof orchestrator
still refuses providers missing any required capability. In particular,
microsandbox cannot run that complete preview-based proof yet.

## Configuration and composition

Use `configuredVendorSandbox` from
`@opentenant/sandbox/providers/configured`. Pass validated server configuration,
an installation-owned approved template registry, and any preview mediator.
Packages do not read environment variables or fall back to host credentials.

- E2B requires `SANDBOX_PROVIDER=e2b` and a nonempty `E2B_API_KEY`.
- Local microsandbox requires `SANDBOX_PROVIDER=microsandbox`.
- Omitted configuration returns no vendor adapter. Existing platform selection
  is unchanged; the integrator must connect this factory to its composition root.

Each template mapping binds the full contract template ID, version and digest
to a reviewed provider image and its exact CPU/memory allocation. Unknown
templates and mismatched limits fail before allocation. Review images for
embedded credentials and unsafe startup behavior. Never populate this registry
from tenant input. E2B mappings must use immutable provider template/build IDs;
microsandbox images must already exist locally and be pinned by digest.

Commands use a cleared environment with fixed `HOME` and `PATH`. E2B's shell
process API receives individually quoted argv elements. Microsandbox receives
structured argv. Neither adapter supplies host environment, cloud workload
identity, secrets, mounts or registry credentials to the guest. Output capture,
file writes, artifact reads and lifetimes are bounded. Provider exceptions are
normalized without returning their text or credentials.

## E2B

The pinned dependency is `e2b@2.63.0`. Its published npm manifest declares MIT,
which is permitted by the reuse policy. This differs from the plan's Apache
label. No vendor source was copied. See the
[SDK source](https://github.com/e2b-dev/E2B/tree/main/packages/js-sdk) and
[network documentation](https://docs.e2b.dev/network/internet-access).

Creation disables internet access, requests IPv4 and IPv6 deny-all rules, an
empty allowlist and private inbound traffic, then checks returned policy and
CPU/memory. If a deployment rejects these controls, omits the readback or cannot
enforce them, creation fails and any returned sandbox is killed. DNS allowlists
are refused because name filtering alone does not prove connect-time exclusion
of private or metadata addresses. There is no permissive fallback.

Private preview requests need E2B's traffic access token. `protectPreview` must
register a separate HTTPS route bound to tenant, workspace and expiry, store
the token server-side, and attach the upstream authentication header. It must
enforce expiry on every request. Returning the provider origin, a URL containing
credentials or a query token fails. The adapter cannot implement the mediator's
HTTP authentication; that is an explicit integration obligation.

Any operation error or nonzero command kills the sandbox. Teardown is
idempotent after acknowledgement; a failed kill remains retryable. Provider
duration controls back the local expiry timer. Process failure before a create
response can leave an unknown hosted resource until the provider deadline;
owner-approved deployment must verify this expiry behavior and cleanup.
Hosted execution still needs exact owner approval under
[OWNER-TASKS.md](../OWNER-TASKS.md).

## Local microsandbox

The maintained `microsandbox@0.7.13` JavaScript SDK is Apache-2.0. Its current
local backend starts the microVM directly; it needs no HTTP server. See the
[SDK overview](https://github.com/superradcompany/microsandbox/blob/main/docs/sdk/overview.mdx)
and [TypeScript SDK](https://github.com/superradcompany/microsandbox/tree/main/sdk/node-ts).
Native runtime artifacts come from pinned optional npm packages.

The SDK's backend setting is process-wide. Run this adapter in a dedicated
local execution process and do not concurrently switch its SDK backend to
cloud. The adapter selects local synchronously before creation, uses unique
names, refuses image pulls, disables networking and creates ephemeral attached
VMs. No cloud API key is used. Errors kill the VM, including failed boot records
that can be found by the generated name. Native duration limits survive adapter
process failure.

`pnpm sandbox:microvm-proof` runs the required lifecycle test in a disposable
Linux Node 22 container. `MICROSANDBOX_REQUIRED=1` makes missing image/KVM fail;
the launcher checks the JSON report for exactly one passed test and zero skips.
It runs two VMs to distinguish explicit termination from timeout cleanup.

The launcher uses `--device /dev/kvm`, Docker's default capabilities/seccomp,
and container root to open the device without adding the host user to `kvm`.
It needs neither `--privileged`, `/dev/vhost-vsock`, `/dev/net/tun`, nor added
capabilities. `--network host` lets a loopback-only host listener provide a
positive connection control before the guest tries it. Docker bridge access to
that listener timed out twice on this host. The VM itself has networking
disabled, only `lo`/`dummy0`, and no IPv4 or IPv6 routes. No Docker socket, host
home or credentials enter the container. The repository bind is read-only;
the guest receives neither that bind nor host environment variables.

The npm SDK README documents `MSB_HOME`, the bundled native runtime and local
image API. The bundled CLI's `image --help` documents `image pull`, which fills
that separate cache. The launcher runs `msb image pull <digest>` inside the
container with a fresh `/tmp/msb-proof` home, verifies `Image.get`, then creates
VMs with `pullPolicy("never")`. Docker's image cache alone is insufficient.
Only the public OCI registry is contacted during preparation.

Pinned images are recorded in `tooling/proofs/docker.mjs`:

- Node 22 bookworm: `sha256:e13726ca604184d7a91fcacab1fc09eefd642dc28e79ac34e85540dd93b78cfb`.
- Alpine 3.22.2 OCI index: `sha256:4b7ce07002c69e8f3d704a9c5d6fd3053be500b7f1c69fc0d80990c2ad8dd412`.
  The local amd64 manifest resolves to `sha256:85f2b723e106c34644cd5851d7e81ee87da98ac54672b29947c052a45d31dc2f`.

On 2026-11-14 the local proof passed without skips. Boot measured **0.447 s**,
the test **1.245 s**, and the complete command **3.906 s**, including pull,
container startup and cleanup. A 250 ms deadline stopped a 30-second sleep in
**290.803 ms**, including VM destruction. Assertions cover file round-trip,
commands, cleared environment with a synthetic host canary, denied public
`1.1.1.1:443` and live host-listener connections, and a 4,096-byte command
truncated to 100 bytes. After explicit terminate and timeout, lookup by name
fails, the SDK list is empty, and no runtime process or KVM descriptor remains.

The real proof found two adapter defects hidden by mocks. Draining an exec
stream consumes its exit event, so a subsequent `wait()` returned
`RuntimeError: runtime error: exec session ended without exit event`.
The adapter now retains the streamed exit code. `killWithTimeout()` stopped
the VM but retained its record; teardown now calls identity-bound
`destroy({ force: true, timeoutMs: 10000 })`.

CI has an Ubuntu-hosted `microvm-proof` job and the documented KVM udev rule
used by android-emulator-runner. Its name explicitly asks the owner to confirm
hosted runner KVM support. **This branch has not run in GitHub CI.**
See the [full local proof record](../reviews/2026-11-14-real-sandbox-smtp-proofs.md)
for failed development attempts and verification counts.

Checkpoints, restore and named process logs remain unsupported in both new
adapters. No provider is approved for production or genuine tenant data by
this change.
