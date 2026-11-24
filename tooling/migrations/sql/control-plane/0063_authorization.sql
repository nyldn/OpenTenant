-- Optional provider IDs are installation configuration, never tenant grants.
create table authorization_provider_config (
  singleton boolean primary key default true check (singleton),
  installation_id text not null references installation_metadata (installation_id),
  provider text not null check (provider in ('in-process', 'openfga')),
  store_id text,
  model_id text,
  updated_at timestamptz not null default now(),
  constraint openfga_ids_required check (
    (provider = 'in-process' and store_id is null and model_id is null)
    or (provider = 'openfga' and store_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$' and model_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'
      and store_id is not null and model_id is not null)
  )
);
comment on table authorization_provider_config is
  'Optional operator-managed store/model IDs; environment config is the initial composition source. No credentials.';

-- Trusted catalog snapshot; NULL preserves legacy manifests. Registration must
-- store the reviewed manifest alongside each future module catalog publication.
alter table module_catalog add column authorization_manifest jsonb;
alter table module_catalog add constraint authorization_manifest_bound check (
  authorization_manifest is null or (
    jsonb_typeof(authorization_manifest) = 'object'
    and authorization_manifest ? 'key'
    and authorization_manifest ->> 'key' = module_key
    and jsonb_typeof(authorization_manifest -> 'permissions') = 'array'
    and authorization_manifest ? 'permissions'
    and (not (authorization_manifest ? 'rolePermissions')
      or jsonb_typeof(authorization_manifest -> 'rolePermissions') = 'object')
  )
);

-- Built-in modules adopt the platform ceiling on upgrade as well as fresh installs.
update module_catalog set authorization_manifest = '{"key":"assessment","version":"1.0.0","runtime":"native","navigation":[],"permissions":["assessment.use"],"rolePermissions":{"tenant_owner":["assessment.use"],"tenant_admin":["assessment.use"],"tenant_member":["assessment.use"]}}'::jsonb where module_key = 'assessment';

-- Built-in modules adopt the platform ceiling on upgrade as well as fresh installs.
update module_catalog set authorization_manifest = '{"key":"brain","version":"0.1.0","runtime":"native","navigation":[],"permissions":["brain.use","brain.promote","brain.admin"],"rolePermissions":{"tenant_owner":["brain.use","brain.promote","brain.admin"],"tenant_admin":["brain.use","brain.promote","brain.admin"],"tenant_member":["brain.use"]}}'::jsonb where module_key = 'brain';

-- Built-in modules adopt the platform ceiling on upgrade as well as fresh installs.
update module_catalog set authorization_manifest = '{"key":"support","version":"0.1.0","runtime":"native","navigation":[],"permissions":["support.ticket.create","support.ticket.reply","support.ticket.assign","support.ticket.manage","support.ticket.escalate","support.config.manage","support.analytics.read","support.knowledge.manage","support.use","support.admin"],"rolePermissions":{"tenant_owner":["support.ticket.create","support.ticket.reply","support.ticket.assign","support.ticket.manage","support.ticket.escalate","support.config.manage","support.analytics.read","support.knowledge.manage","support.use","support.admin"],"tenant_admin":["support.ticket.create","support.ticket.reply","support.ticket.assign","support.ticket.manage","support.ticket.escalate","support.config.manage","support.analytics.read","support.knowledge.manage","support.use","support.admin"],"tenant_member":["support.use"]}}'::jsonb where module_key = 'support';
