# Rotate stored encryption keys

The trusted server accepts `TENANT_DB_ENCRYPTION_KEYS` as comma-separated
`id:base64` entries and `TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID` as the write key.
Each key decodes to exactly 32 bytes. IDs use 1–64 ASCII letters, digits,
underscores or hyphens. Duplicate IDs and conflicting keys fail validation.
`TENANT_DB_ENCRYPTION_KEY` remains accepted as `k0`, including alongside a
keyring. Never reuse an ID for different key material.

New ciphertext uses `v1.aesgcm256.<key-id>.<base64url-iv>.<base64url-ciphertext-and-tag>`.
The authenticated data binds both the header and the existing tenant/context.
Readers also accept the former base64 IV/ciphertext/tag format under `k0`.
New writes always use v1, including when only `k0` is configured. Drain old
reader processes before allowing upgraded instances to write credentials. For
a rolling code upgrade, pause credential mutations until all readers accept
v1. Change the active write key only after that reader rollout completes.

This extends the existing Node crypto implementation with an envelope modeled
on MIT-licensed @47ng/cloak. No upstream implementation is copied or vendored.
Keeping the existing AES-GCM and legacy decoder avoids introducing the AWS
Encryption SDK's different message format and preserves tenant AAD compatibility.

## Procedure

1. Apply control-plane migration `0045_credential_rotation` through the normal
   migration runner. Back up the control plane and retain its encryption keys
   through the backup retention window.
2. Add the new key under a new ID. Keep every old key available to readers.
   Set the active ID and roll every writer and worker to the new configuration.
   Supply secrets through your deployment's secret mechanism, never command
   arguments, source files, logs or shell history.
3. Set `CONTROL_PLANE_DATABASE_URL` and attributable `KEY_ROTATION_ACTOR_ID`
   in the trusted operator environment. Remote URLs must use
   `sslmode=verify-full`. Run:

   ```sh
   pnpm keys:rotate --dry-run --batch-size 100
   pnpm keys:rotate --apply --batch-size 100
   ```

4. The command prints a non-secret run UUID before database work and then only
   status and counts. Save the UUID. It never prints a credential, ciphertext,
   SQL error, address or connection URL. `rotated` means candidates in dry-run
   mode and committed replacements in apply mode. Dry-run writes checkpoints
   and audit events, but leaves credential columns unchanged.
5. To pause after a bounded amount of work, pass `--max-batches 5`. On an
   interruption or failure, correct the cause and resume with the same mode,
   actor and key material:

   ```sh
   pnpm keys:rotate --apply --resume RUN_UUID --batch-size 100
   ```

   A batch holds at most 1,000 credential values in memory. Each batch commits
   replacements, the checkpoint and a hash-chained audit event together. A
   failed or killed transaction rolls back. The run record survives a failed
   first batch. Concurrent credential changes abort that batch without
   overwriting the writer. Resume re-reads it. Completed runs are idempotent;
   omit `--resume` to start a new full scan.
6. Run a fresh dry-run after apply. Require `status=completed` and `rotated=0`
   before retiring any old key. All writers must already use the new active ID;
   a checkpoint cannot cover a concurrent old-key write behind its cursor.

The inventory includes tenant database connection bytea values, both OAuth
vault token columns, and tenant plus installation model-provider credentials.
Bytea values contain UTF-8 wire strings. No tenant database connection is
opened by rotation. Slack's current in-memory encrypted credential boundary
has no durable store to rewrite. OAuth PKCE state is browser-held, so retain old
keys until all outstanding OAuth state expires. Retain old keys separately
for backups and rollback; removing them makes old backups unreadable.

`credentials.rotation.started`, `.batch`, `.resumed`, `.completed` and `.failed`
events record the operator, run UUID, mode, target ID and counts without secret
material. Run checkpoints are operational state; audit events use the existing
append-only hash chain.

## Local proof

Use a disposable `pgvector/pgvector:0.8.2-pg17-bookworm` database on loopback
port 55442, named `opentenant_it_rotation`, and set `KEY_ROTATION_DATABASE_URL`.
The integration suite drops and recreates only that dedicated local schema.

```sh
pnpm --filter @opentenant/database exec vitest run src/credential-cipher.test.ts src/credential-cipher-rotation.postgres.test.ts
```
