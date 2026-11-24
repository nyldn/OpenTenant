-- Remote modules (ADR-003) are composed by reference: the platform proxies a
-- path prefix to the module's own deployment. This records where.

alter table module_catalog add column remote_url text;

-- A remote module must declare where it is served from.
alter table module_catalog
  add constraint module_catalog_remote_requires_url
  check (runtime <> 'remote' or remote_url is not null);
