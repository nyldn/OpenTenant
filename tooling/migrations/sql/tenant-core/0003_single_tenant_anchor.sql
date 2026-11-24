-- A tenant database has exactly one identity anchor. The constant, checked
-- singleton value makes a second tenant row fail at the database boundary,
-- including when FORCE RLS correctly hides the existing tenant from a caller.
alter table tenant_core.tenant_meta
  add column singleton boolean not null default true,
  add constraint tenant_meta_singleton_check check (singleton),
  add constraint tenant_meta_singleton_key unique (singleton);
