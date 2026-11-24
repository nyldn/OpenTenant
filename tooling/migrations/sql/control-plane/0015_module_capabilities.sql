create table module_creator_capability_authorities (
  authority_id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants (tenant_id) on delete restrict,
  creator_user_id text not null references platform_users (user_id) on delete restrict,
  capability text not null check (capability in ('support.ticket.read')),
  granted_by_user_id text not null references platform_users (user_id) on delete restrict,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  constraint module_creator_capability_authority_expiry_order check (
    expires_at is null or expires_at > granted_at
  ),
  constraint module_creator_capability_authority_revocation_order check (
    revoked_at is null or revoked_at >= granted_at
  )
);

create unique index module_creator_capability_authority_one_active_idx
  on module_creator_capability_authorities (tenant_id, creator_user_id, capability)
  where revoked_at is null;

create function enforce_module_creator_capability_authority() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'module creator capability authority cannot be deleted';
  end if;
  if tg_op = 'UPDATE' then
    if old.revoked_at is not null
       or new.revoked_at is null
       or (old.authority_id, old.tenant_id, old.creator_user_id, old.capability,
           old.granted_by_user_id, old.granted_at, old.expires_at)
          is distinct from
          (new.authority_id, new.tenant_id, new.creator_user_id, new.capability,
           new.granted_by_user_id, new.granted_at, new.expires_at) then
      raise exception 'module creator capability authority permits only one-way revocation';
    end if;
    return new;
  end if;
  if new.expires_at is not null and new.expires_at <= clock_timestamp() then
    raise exception 'module creator capability authority must be active when created';
  end if;
  return new;
end;
$$;

create trigger module_creator_capability_authority_enforce_mutation
  before insert or update or delete on module_creator_capability_authorities
  for each row execute function enforce_module_creator_capability_authority();

alter table module_versions
  add constraint module_versions_creator_identity_unique
  unique (module_key, version, created_by_user_id);

create function lock_module_capability_publication() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.module_key || '@' || new.version, 0));
  return new;
end;
$$;

create trigger module_versions_lock_capability_publication
  before insert on module_versions
  for each row execute function lock_module_capability_publication();

create table module_version_capabilities (
  module_key text not null,
  module_version text not null,
  capability text not null check (capability in ('support.ticket.read')),
  runtime_permission text not null check (
    runtime_permission ~ '^[a-z][a-z0-9-]{1,63}\.[a-z][a-z0-9._-]{1,127}$'
    and left(runtime_permission, length(module_key) + 1) = module_key || '.'
  ),
  creator_user_id text not null references platform_users (user_id) on delete restrict,
  creator_authority_id uuid not null references module_creator_capability_authorities (authority_id) on delete restrict,
  declared_at timestamptz not null default now(),
  primary key (module_key, module_version, capability),
  constraint module_version_capabilities_version_fkey
    foreign key (module_key, module_version, creator_user_id)
    references module_versions (module_key, version, created_by_user_id)
    on delete restrict
    deferrable initially deferred
);

create function enforce_module_capability_declaration_immutability() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'published module capability declarations are immutable';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(new.module_key || '@' || new.module_version, 0)
  );
  if exists (
    select 1 from module_versions
     where module_key = new.module_key and version = new.module_version
  ) then
    raise exception 'module capabilities must be declared before publishing the version';
  end if;
  perform 1
    from module_creator_capability_authorities authority
    join module_catalog catalog on catalog.module_key = new.module_key
   where authority.authority_id = new.creator_authority_id
     and authority.creator_user_id = new.creator_user_id
     and authority.capability = new.capability
     and authority.tenant_id = catalog.owner_tenant_id
     and catalog.ownership_scope = 'tenant'
     and authority.revoked_at is null
     and (authority.expires_at is null or authority.expires_at > clock_timestamp())
   for share of authority;
  if not found then
    raise exception 'module capability declaration lacks active persisted creator authority';
  end if;
  return new;
end;
$$;

create trigger module_version_capabilities_enforce_immutability
  before insert or update or delete on module_version_capabilities
  for each row execute function enforce_module_capability_declaration_immutability();

create table tenant_module_capability_grants (
  grant_id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants (tenant_id) on delete restrict,
  module_key text not null,
  module_version text not null,
  capability text not null,
  granted_by_user_id text not null references platform_users (user_id) on delete restrict,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  constraint tenant_module_capability_grants_declaration_fkey
    foreign key (module_key, module_version, capability)
    references module_version_capabilities (module_key, module_version, capability)
    on delete restrict,
  constraint tenant_module_capability_grants_expiry_order check (
    expires_at is null or expires_at > granted_at
  ),
  constraint tenant_module_capability_grants_revocation_order check (
    revoked_at is null or revoked_at >= granted_at
  )
);

create unique index tenant_module_capability_grants_one_active_idx
  on tenant_module_capability_grants (tenant_id, module_key, module_version, capability)
  where revoked_at is null;

create function enforce_tenant_module_capability_grant() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  entitlement_valid boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'module capability grants cannot be deleted';
  end if;

  if tg_op = 'UPDATE' then
    if old.revoked_at is not null
       or new.revoked_at is null
       or (old.grant_id, old.tenant_id, old.module_key, old.module_version,
           old.capability, old.granted_by_user_id, old.granted_at, old.expires_at)
          is distinct from
          (new.grant_id, new.tenant_id, new.module_key, new.module_version,
           new.capability, new.granted_by_user_id, new.granted_at, new.expires_at) then
      raise exception 'module capability grants permit only one-way revocation';
    end if;
    return new;
  end if;

  if new.expires_at is not null and new.expires_at <= clock_timestamp() then
    raise exception 'module capability grants must be active when created';
  end if;

  select exists (
    select 1
      from tenant_modules assignment
      join module_catalog catalog on catalog.module_key = assignment.module_key
      join module_version_capabilities declaration
        on declaration.module_key = assignment.module_key
       and declaration.module_version = assignment.module_version
       and declaration.capability = new.capability
      join module_creator_capability_authorities authority
        on authority.authority_id = declaration.creator_authority_id
      cross join installation_metadata installation
     where assignment.tenant_id = new.tenant_id
       and assignment.module_key = new.module_key
       and assignment.module_version = new.module_version
       and assignment.enabled = true
       and authority.revoked_at is null
       and (authority.expires_at is null or authority.expires_at > clock_timestamp())
       and installation.singleton = true
       and (
         catalog.ownership_scope = 'platform'
         or (catalog.ownership_scope = 'installation'
             and catalog.installation_id = installation.installation_id)
         or (catalog.ownership_scope = 'tenant'
             and catalog.installation_id = installation.installation_id
             and catalog.owner_tenant_id = new.tenant_id)
       )
  ) into entitlement_valid;

  if not entitlement_valid then
    raise exception 'module capability grant violates the active tenant entitlement';
  end if;
  return new;
end;
$$;

create trigger tenant_module_capability_grants_enforce_mutation
  before insert or update or delete on tenant_module_capability_grants
  for each row execute function enforce_tenant_module_capability_grant();

comment on table module_creator_capability_authorities is
  'Server-owned tenant/creator ceiling for capabilities that may be declared by a module';
comment on table module_version_capabilities is
  'Immutable capability declarations bound to active persisted creator authority before version publication';
comment on table tenant_module_capability_grants is
  'Tenant-scoped, version-bound capability grants with append-only revocation history';
