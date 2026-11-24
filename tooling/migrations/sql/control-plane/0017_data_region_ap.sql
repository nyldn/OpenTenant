-- ADR-006: widen the coarse data-region vocabulary to include Asia-Pacific.
--
-- Neon serves aws-ap-southeast-1 and aws-ap-southeast-2. The coarse value is a
-- projection of the fine provider region, so excluding 'ap' would make those
-- regions unprovisionable rather than merely undocumented.
--
-- Transaction management is owned by the migration runner; do not add
-- begin/commit here.

alter table tenants
  drop constraint tenants_data_region_check;

alter table tenants
  add constraint tenants_data_region_check
  check (data_region in ('us', 'eu', 'ap'));

comment on column tenants.data_region is
  'ADR-006 coarse residency class, projected from the provider region. One of us, eu, ap.';
