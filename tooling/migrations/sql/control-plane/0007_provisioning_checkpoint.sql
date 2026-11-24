-- Checkpoint columns so tenant provisioning is resumable (spec 9.2/15): a
-- retried job continues from the last completed step instead of duplicating
-- the Neon project.

alter table provisioning_jobs add column project_id text;
alter table provisioning_jobs add column region text;
alter table provisioning_jobs add column migrated boolean not null default false;
alter table provisioning_jobs add column stored boolean not null default false;

-- One provisioning job per (tenant, kind) so the checkpoint upsert is stable.
create unique index provisioning_jobs_tenant_kind_idx on provisioning_jobs (tenant_id, kind);
