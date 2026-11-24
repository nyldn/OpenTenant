-- External identity-provider identifiers belong only in the control plane.
-- Preserve the provider-neutral tenant metadata while upgrading existing
-- tenant databases created by the immutable initial migration.
alter table tenant_core.tenant_meta
  drop column if exists organization_id;
