-- Checkpoints commit atomically with ciphertext updates and hash-chained audit.
-- No credential material or row identifiers are stored in audit details.
create table credential_rotation_runs (
  run_id uuid primary key,
  active_key_id text not null,
  active_key_fingerprint text not null,
  mode text not null check (mode in ('dry-run', 'apply')),
  actor_id text not null,
  cursor text not null default '',
  scanned integer not null default 0 check (scanned >= 0),
  rotated integer not null default 0 check (rotated >= 0 and rotated <= scanned),
  status text not null default 'running' check (status in ('running', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
