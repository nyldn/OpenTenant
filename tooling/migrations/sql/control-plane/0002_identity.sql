-- Identity tables backing the AccountLinkStore and platform users
-- (architecture spec 8.1). Provider identifiers appear only here and are
-- read exclusively by the WorkOS adapter's stores.

create table platform_users (
  user_id text primary key,
  email text not null,
  display_name text,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table platform_users is 'architecture spec section 8.1';

create table identity_account_links (
  user_id text not null references platform_users (user_id),
  provider text not null default 'workos',
  external_subject text not null,
  primary key (provider, external_subject),
  unique (user_id, provider)
);

comment on table identity_account_links is 'architecture spec section 8.1';

-- Internal membership identifiers mapped to provider objects. kind
-- distinguishes WorkOS invitations from organization memberships so
-- revocation targets the right object.
create table membership_links (
  membership_id text primary key,
  provider text not null default 'workos',
  external_kind text not null check (external_kind in ('membership', 'invitation')),
  external_id text not null,
  unique (provider, external_kind, external_id)
);

comment on table membership_links is 'architecture spec section 8.1';
