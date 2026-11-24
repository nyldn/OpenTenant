alter table module_catalog
  add column ownership_scope text not null default 'platform'
    check (ownership_scope in ('platform', 'installation', 'tenant')),
  add column installation_id text references installation_metadata (installation_id),
  add column owner_tenant_id text references tenants (tenant_id),
  add constraint module_catalog_ownership_shape check (
    (ownership_scope = 'platform' and installation_id is null and owner_tenant_id is null)
    or (ownership_scope = 'installation' and installation_id is not null and owner_tenant_id is null)
    or (ownership_scope = 'tenant' and installation_id is not null and owner_tenant_id is not null)
  ),
  add constraint module_catalog_default_is_platform_only check (
    not enabled_by_default or ownership_scope = 'platform'
  );

comment on column module_catalog.ownership_scope is
  'Immutable platform, installation, or tenant ownership boundary';
comment on column module_catalog.owner_tenant_id is
  'Exact tenant allowed to receive a tenant-private module';

-- The default exists only to backfill the pre-ownership catalog above. Every
-- new identity must state its ownership explicitly; omission fails closed.
alter table module_catalog alter column ownership_scope drop default;

create table module_versions (
  module_key text not null references module_catalog (module_key) on delete restrict,
  version text not null check (version ~ '^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$'),
  artifact_digest text not null check (artifact_digest ~ '^[a-f0-9]{64}$'),
  digest_kind text not null default 'sha256_artifact'
    check (digest_kind in ('sha256_artifact', 'legacy_identity')),
  remote_url text,
  source_module_key text,
  source_version text,
  source_artifact_digest text check (
    source_artifact_digest is null or source_artifact_digest ~ '^[a-f0-9]{64}$'
  ),
  reviewed_by_user_id text references platform_users (user_id),
  reviewed_at timestamptz,
  created_by_user_id text references platform_users (user_id),
  published_by_user_id text references platform_users (user_id),
  created_at timestamptz not null default now(),
  primary key (module_key, version),
  constraint module_versions_promotion_complete check (
    (source_module_key is null and source_version is null
      and source_artifact_digest is null and reviewed_by_user_id is null
      and reviewed_at is null and published_by_user_id is null)
    or
    (source_module_key is not null and source_version is not null
      and source_artifact_digest is not null and reviewed_by_user_id is not null
      and reviewed_at is not null and published_by_user_id is not null)
  ),
  constraint module_versions_promotion_new_identity check (
    source_module_key is null or source_module_key <> module_key
  ),
  constraint module_versions_promotion_new_version check (
    source_version is null or source_version <> version
  ),
  constraint module_versions_promotion_new_artifact check (
    source_artifact_digest is null or source_artifact_digest <> artifact_digest
  ),
  constraint module_versions_publisher_created_copy check (
    source_module_key is null or created_by_user_id = published_by_user_id
  )
);

insert into module_versions (module_key, version, artifact_digest, digest_kind, remote_url)
select module_key, version,
       encode(sha256(convert_to(module_key || '@' || version, 'UTF8')), 'hex'),
       'legacy_identity',
       remote_url
  from module_catalog;

alter table module_versions
  add constraint module_versions_promotion_source_fkey
  foreign key (source_module_key, source_version)
  references module_versions (module_key, version)
  on delete restrict;

alter table module_catalog
  add constraint module_catalog_initial_version_fkey
  foreign key (module_key, version)
  references module_versions (module_key, version)
  deferrable initially deferred;

alter table tenant_modules add column module_version text;

update tenant_modules assignment
   set module_version = catalog.version
  from module_catalog catalog
 where catalog.module_key = assignment.module_key;

alter table tenant_modules alter column module_version set not null;

alter table tenant_modules
  add constraint tenant_modules_version_fkey
  foreign key (module_key, module_version)
  references module_versions (module_key, version)
  on delete restrict;

create function enforce_module_catalog_ownership() returns trigger
language plpgsql as $$
declare
  current_installation_id text;
begin
  if tg_op = 'UPDATE' and (
    old.module_key,
    old.version,
    old.runtime,
    old.remote_url,
    old.ownership_scope,
    old.installation_id,
    old.owner_tenant_id
  ) is distinct from (
    new.module_key,
    new.version,
    new.runtime,
    new.remote_url,
    new.ownership_scope,
    new.installation_id,
    new.owner_tenant_id
  ) then
    raise exception 'module identity and ownership are immutable';
  end if;

  if new.ownership_scope <> 'platform' then
    select installation_id into current_installation_id
      from installation_metadata where singleton = true;
    if current_installation_id is null or new.installation_id <> current_installation_id then
      raise exception 'module ownership violates the installation boundary';
    end if;
  end if;
  return new;
end;
$$;

create trigger module_catalog_enforce_ownership
  before insert or update on module_catalog
  for each row execute function enforce_module_catalog_ownership();

create function enforce_module_version_immutability() returns trigger
language plpgsql as $$
declare
  source_record record;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'published module versions are immutable';
  end if;

  if new.source_module_key is not null then
    select source_version.artifact_digest,
           source_version.digest_kind,
           source_version.created_at,
           source_catalog.ownership_scope,
           source_catalog.installation_id,
           target_catalog.ownership_scope as target_scope,
           target_catalog.installation_id as target_installation_id
      into source_record
      from module_versions source_version
      join module_catalog source_catalog
        on source_catalog.module_key = source_version.module_key
      join module_catalog target_catalog
        on target_catalog.module_key = new.module_key
     where source_version.module_key = new.source_module_key
       and source_version.version = new.source_version;

    if not found then
      raise exception 'module promotion review does not match its ownership-bound source';
    end if;
    if source_record.ownership_scope <> 'tenant'
       or source_record.target_scope <> 'installation'
       or source_record.installation_id <> source_record.target_installation_id
       or source_record.artifact_digest <> new.source_artifact_digest
       or source_record.digest_kind <> 'sha256_artifact'
       or new.reviewed_at < source_record.created_at
       or new.reviewed_at > clock_timestamp() then
      raise exception 'module promotion review does not match its ownership-bound source';
    end if;
  end if;
  if new.created_by_user_id is null then
    select ownership_scope into source_record
      from module_catalog where module_key = new.module_key;
    if found and source_record.ownership_scope <> 'platform' then
      raise exception 'non-platform module versions require an attributable creator';
    end if;
  end if;
  return new;
end;
$$;

create trigger module_versions_enforce_immutability
  before insert or update or delete on module_versions
  for each row execute function enforce_module_version_immutability();

create function enforce_tenant_module_ownership() returns trigger
language plpgsql as $$
declare
  module_record record;
  current_installation_id text;
begin
  select catalog.ownership_scope, catalog.installation_id, catalog.owner_tenant_id
    into module_record
    from module_catalog catalog
    join module_versions version
      on version.module_key = catalog.module_key
     and version.version = new.module_version
   where catalog.module_key = new.module_key;

  if not found then
    raise exception 'module assignment references an unknown version';
  end if;
  if module_record.ownership_scope = 'platform' then
    return new;
  end if;

  select installation_id into current_installation_id
    from installation_metadata where singleton = true;
  if current_installation_id is null
     or module_record.installation_id <> current_installation_id
     or (module_record.ownership_scope = 'tenant'
         and module_record.owner_tenant_id <> new.tenant_id) then
    raise exception 'module assignment violates the ownership boundary';
  end if;
  return new;
end;
$$;

create trigger tenant_modules_enforce_ownership
  before insert or update on tenant_modules
  for each row execute function enforce_tenant_module_ownership();

comment on table module_versions is
  'Immutable module artifacts; reviewed promotions bind a new artifact to an exact tenant-private source';
comment on column module_versions.digest_kind is
  'sha256_artifact for publishable bytes; legacy_identity marks migration backfills that are not artifact proof';
comment on column tenant_modules.module_version is
  'Explicit immutable module artifact version selected for this tenant';
