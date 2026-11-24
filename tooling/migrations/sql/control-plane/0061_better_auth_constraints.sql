-- OpenTenant invariants in addition to the pinned Better Auth schema.
create unique index ba_member_organization_user_unique on ba_member ("organizationId", "userId");
create unique index ba_invitation_pending_email_unique on ba_invitation ("organizationId", lower(email)) where status = 'pending';
alter table ba_invitation add constraint ba_invitation_no_owner check (role in ('member', 'admin'));
alter table ba_session add constraint ba_session_active_organization_fk foreign key ("activeOrganizationId") references ba_organization(id) on delete set null;
