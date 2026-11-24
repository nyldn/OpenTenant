# Audit checkpoint operations

The control-plane `audit_events` chain has one scope per tenant with events and
one platform scope. `pnpm audit:anchor` verifies each complete chain, signs its
head with Ed25519, publishes the note outside Postgres, then records an
append-only receipt in `audit_checkpoints`. The database receipt is not a trust
root. `pnpm audit:verify` reads the external sink and recomputes every chain from
one consistent database snapshot. Both commands run on Node 22 with pnpm
11.13.1 and need no new dependencies.

The verifier checks every external signature against an operator-supplied
public-key allowlist. It compares each scope with its highest signed sequence,
including scopes that have disappeared entirely from the database. A dropped
tail, changed row, reordered sequence, self-consistent rewritten chain, missing
checkpoint, invalid signature, unknown key ID, or unanchored new tail exits 1.
An intact anchored snapshot exits 0. Errors contain a SHA-256 scope digest and
sequence when available, never event content, connection URLs, keys, or provider
errors. An audit event committed after the verifier's snapshot is checked by the
next run.

## Format and provenance

The body follows the C2SP tlog-checkpoint model:

```text
<installation-origin>/platform
<sequence>
<base64 SHA-256 head hash>

— <key-id> <base64 key-hint-and-Ed25519-signature>
```

Tenant origins end in `/tenant/<base64url-encoded-tenant-id>`. The origin prefix
must be stable and unique to the installation, for example
`example.test/audit/installation-a`. It is part of the signature. The sequence
is a chain length, not a Merkle tree size; these checkpoints do not claim to
provide Merkle inclusion or consistency proofs. Sequence zero represents an
empty chain and uses SHA-256 of the UTF-8 string `genesis` as its head.

The signed-note key hint is the first four bytes of SHA-256 over the UTF-8 key
ID, newline, algorithm byte `0x01`, and raw Ed25519 public key. The signature
covers the three body lines including their final newline. This implementation
accepts one signature per note and supports rotation by retaining notes under
multiple allowed key IDs. It rejects noncanonical envelopes and encodings.

Format references are <https://c2sp.org/tlog-checkpoint> and
<https://c2sp.org/signed-note>. Implementation uses Node built-ins and existing
OpenTenant chain hashing. No third-party implementation was copied or adapted;
no new third-party notice or runtime dependency is required.

## Key custody and configuration

Run the anchor job as a dedicated operator or scheduler identity outside the
web application's runtime. Give its database role SELECT on `audit_events` and
SELECT/INSERT on `audit_checkpoints`, with no schema ownership or trigger
management. The verifier only needs SELECT on `audit_events`. The application
runtime needs no checkpoint signing key or external-sink write permission.

Use these separate variables in the job's secret/environment configuration:

| Variable | Purpose |
| --- | --- |
| `AUDIT_DATABASE_URL` | Explicit database connection for this job |
| `AUDIT_CHECKPOINT_ORIGIN` | Stable installation-specific origin prefix |
| `AUDIT_CHECKPOINT_DIRECTORY` | Absolute external filesystem directory or dedicated Git repository |
| `AUDIT_CHECKPOINT_SINK` | `file` by default, or `git` |
| `AUDIT_CHECKPOINT_PUBLIC_KEYS` | JSON object mapping trusted key IDs to SPKI public PEM strings |
| `AUDIT_CHECKPOINT_KEY_ID` | Active signing key ID, such as `audit-2026-11` |
| `AUDIT_CHECKPOINT_PRIVATE_KEY` | Active Ed25519 PKCS#8 private PEM, required only by the anchor job |

Never reuse cookie, session, HMAC, module access, connection, or database secrets
as the checkpoint key. Do not put the private key in Git, the database, command
arguments, shell tracing, logs, screenshots, or application responses. Store it
in a restricted local secret file or your operator-managed secret store, and
inject the PEM into `AUDIT_CHECKPOINT_PRIVATE_KEY` only for the signing process.
Disable shell tracing before injecting secrets. Generate keys locally without
printing the private material, for example in an already protected directory:

```sh
umask 077
node --input-type=module <<'JS'
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const keys = generateKeyPairSync('ed25519');
writeFileSync('audit-private.pem', keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
writeFileSync('audit-public.pem', keys.publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx', mode: 0o600 });
JS
```

Only distribute the public key to verifiers. Build the JSON allowlist with a
JSON encoder so PEM newlines are escaped correctly. `verify` does not read or
require `AUDIT_CHECKPOINT_PRIVATE_KEY`.

## Running and scheduling

Apply the forward control-plane and tenant migrations through the normal
migration runner before starting. Configure the variables above, then run:

```sh
pnpm audit:anchor
pnpm audit:verify
```

Schedule `pnpm audit:anchor` using the installation's scheduler, and alert on
nonzero exit codes. Run `pnpm audit:verify` independently with public keys and
read access to the sink. Choose the interval to bound how much recently written
history could disappear before the next external anchor. Verification fails
with `unanchored_tail` when legitimate writes occurred after the last anchor;
run anchoring, then retry verification. No scheduler or cloud service is
activated by these commands.

For development, the file sink atomically creates content-addressed files with
exclusive publication and fsync. Retries preserve the existing identical file;
a conflicting file fails. It never overwrites or removes checkpoint files.
Filesystem administrators can still alter or delete them. Keep the directory
outside the database volume, with separate custody and backups.

For a Git sink, initialize a dedicated local repository and configure the
operator's Git author locally before setting `AUDIT_CHECKPOINT_SINK=git`.
The repository must be clean, and its top-level directory must exactly match
the configured directory. The adapter serializes commits with a repository
lock, disables hooks and commit signing, and commits only checkpoint files.
Git subprocesses receive an explicit minimal environment without signer or
database credentials.
It never invokes fetch, push, remote helpers, or a shell. Signed notes provide
the cryptographic signature even though Git commits themselves are unsigned.
Retries create no duplicate commit. Commit failure leaves the checkpoint file
for operator inspection; resolve the failed commit and restore a clean tree
before retrying. Clear a stale `.git/audit-checkpoint.lock` only after proving
no anchor process owns it. Handle any off-machine replication separately under
the installation's normal approval and credential policy.

## Rotation, recovery, and limits

1. Generate a new Ed25519 key and a new key ID. Never replace a public key
   under an existing ID.
2. Add the new public key to every verifier's allowlist while retaining all
   historical public keys. Deploy that allowlist before changing the signer.
3. Set the anchor job's active key ID and private key to the new pair. The job
   verifies old checkpoints first and refuses to sign with an untrusted key.
4. Run anchoring and verification. Retain the old public keys and external
   notes for the lifetime of the audit evidence. Remove the old private key
   from active signer custody after the rotation is verified.

Keep external notes and the public-key allowlist through database restores.
Never lower the accepted sequence or delete notes just to make a restored
backup pass verification. A restore older than an external head is a
`dropped_tail` incident requiring reconciliation. If a signing key is
compromised, preserve evidence, stop signing, investigate the last independently
trusted checkpoint, and rotate through the incident process. A valid signature
alone cannot distinguish an attacker who also stole the signing key.

The first anchor requires independently trusted existing history. Canonical
chain verification cannot prove that an owner never rewrote history before
that first anchor. Legacy unbound hash formats remain readable through
`PgAuditStore.verifyChain`, but anchoring rejects them with
`legacy_unbound_chain`; preserve and review such histories explicitly before
an operator-approved transition. The command never rewrites legacy rows.

Forward migrations block TRUNCATE, including owner execution, on
`audit_events`, `audit_checkpoints`, `model_resolution_events`,
`model_stream_terminal_events`, `brain.decisions_log`, `brain.raw_signals`,
and Support's `ticket_events`, `depth_events`, `outbox_events`,
`delivery_attempts`, and `slack_action_receipts`. Tenant-local Brain and Support
logs get TRUNCATE protection; these signed checkpoints cover the control-plane
per-scope audit chain. A database owner can still disable triggers or drop
schemas. External signed notes detect changes to anchored chain history even
when database receipts disappear. Neither local filesystem permissions nor Git
history prevents a host administrator from destroying all external evidence;
independent retention is an operational requirement.
