-- Ownership context for membership links (Codex review of the auth PR):
-- without tenant and user attribution the platform cannot prove a referenced
-- provider membership belongs to the tenant being administered.

alter table membership_links add column tenant_id text references tenants (tenant_id);
alter table membership_links add column user_id text references platform_users (user_id);

create index membership_links_tenant_idx on membership_links (tenant_id);
