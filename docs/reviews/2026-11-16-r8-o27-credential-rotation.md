# R8 O27 credential rotation contract receipt

Base: `41adc71`. Local synthetic preparation only. Marketing impact: none.

`CredentialRotationPort` separates role credentials from provider composition.
`PostgresCredentialRotation` preserves local SQL rotation. The shared grant
helper preserves role membership and database CONNECT for custom roles, schema
USAGE, table SELECT/INSERT/UPDATE, sequence USAGE/SELECT and both default
privilege grants. Both paths retain NOBYPASSRLS, NOSUPERUSER, NOCREATEDB,
NOCREATEROLE and NOREPLICATION. Existing module-specific grants are untouched.

`NeonCredentialRotation` creates a missing NOLOGIN role, reasserts safe role
attributes and grants, and delegates password generation/reset to an injected
`NeonRolePasswordApi`. No password is interpolated into SQL on this path.
It binds the configured project/branch to the exact direct hostname, requires
verified TLS, and returns a pooled application URI in memory only. Provider,
JSON, driver and checkpoint errors are normalized. There is no logging call.
The legacy SQL helper now fails closed for Neon hosts before opening a client.

The reviewed repository evidence is
`docs/architecture/evidence/2026-07-20-neon-tenant-live-probe.md`, with its
project API references, and `docs/OWNER-TASKS.md:188`, which records the role
reset requirement and rejection of SCRAM verifiers. Neither contains a reviewed
password-reset endpoint/response or asynchronous operation schema. Accordingly
this change defines an injected API contract, not an invented HTTP transport.
The integrator must review that API schema and implement a transport that waits
for operations before composition. No live Neon request or network lookup was
made, and mocks do not establish provider compatibility.

`rotateCredentialWithCheckpoint` persists encrypted intent, then an encrypted
credential before activation. The structural cipher contract accepts the
existing AES-256-GCM `CredentialCipher` without a new runtime dependency.
AAD binds the run, provider target, role, host and database. Checkpoint stores
must provide durable atomic writes and a target-wide lock with a durable run reservation across failures. Other runs
must be rejected until the pending run completes.
Activation must be idempotent and encrypt/store the URI. A completed run does
not reactivate an obsolete credential. An activation failure reuses the same
pending credential on resume. Tampering and cross-target replay fail closed.

There is no atomic transaction across Neon and the control plane. A crash after
a successful reset but before the credential checkpoint retries reset before
activation. A failed activation can temporarily interrupt login. Production
composition must quiesce/drain affected traffic and rehearse recovery. This
contract does not implement a live scheduler, lock store or database persistence.

Nine synthetic rotation cases passed, covering create/existing role paths,
SQL/log secrecy, retained grants, encrypted activation recovery, failed
checkpoint persistence, cross-run serialization, tamper/cross-target denial, normalized provider/cleanup errors,
endpoint binding and the local Postgres path. All 24 provisioning tests passed.
Typecheck and provisioning ESLint passed. The tests use the existing real
AES-GCM cipher with random synthetic key material, not a plaintext test cipher.

Integrator wiring stays outside this task's ownership: compose the API adapter,
real cipher, durable checkpoint lock/store and encrypted activation callback in
the platform provisioning root. Do not call the local SQL factory for Neon.
The current one-argument `AppRoleFactory` does not supply branch/project scope;
that wiring needs explicit target resolution from the provisioning checkpoint.
Any actual provider operation remains account and operation gated.

## Integration note (2026-11-17)

The guard that made `createAppRole` reject hosted Neon URIs was reverted during
integration. Provisioning still selects `createAppRole` for the Neon provider,
and `NeonCredentialRotation` is not yet composed into that path, so the guard
would have failed every Neon provisioning run after project creation. That was
Codex P1 on #126. Hosted Neon keeps its previous SQL rotation and pooled-endpoint
behaviour until the reviewed reset HTTP schema and composition land. That
composition remains the open O27 follow-up.
