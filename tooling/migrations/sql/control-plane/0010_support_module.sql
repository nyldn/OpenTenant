-- Native module registration for the support module (WP-B).

insert into module_catalog (module_key, version, runtime, enabled_by_default)
values ('support', '0.1.0', 'native', true)
on conflict (module_key) do nothing;
