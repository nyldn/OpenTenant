-- The SCIM projector may revoke only memberships it created.
alter table ba_member add column "scimManaged" boolean not null default false;
