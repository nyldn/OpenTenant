-- ADR-006: widen the coarse data-region vocabulary to include Asia-Pacific.
--
-- Mirrors control-plane/0017. The tenant data plane must accept the same
-- vocabulary as the control plane or an ap-region tenant cannot be seeded.
--
-- Transaction management is owned by the migration runner; do not add
-- begin/commit here.

alter table tenant_core.tenant_meta
  drop constraint tenant_meta_data_region_check;

alter table tenant_core.tenant_meta
  add constraint tenant_meta_data_region_check
  check (data_region in ('us', 'eu', 'ap'));

comment on column tenant_core.tenant_meta.data_region is
  'ADR-006 coarse residency class, projected from the provider region. One of us, eu, ap.';
