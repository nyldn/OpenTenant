-- Native module registration for the OpenTenant knowledge module scaffold.

insert into module_catalog (module_key, version, runtime, enabled_by_default)
values ('brain', '0.1.0', 'native', false)
on conflict (module_key) do nothing;
