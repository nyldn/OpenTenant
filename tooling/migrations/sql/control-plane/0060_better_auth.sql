-- Better Auth 1.7.21 schema compiled from pinned MIT packages.
-- Reviewed forward migration; never run vendor migrations during startup.
create table "ba_user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "ba_session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "ba_user" ("id") on delete cascade, "activeOrganizationId" text);

create table "ba_account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "ba_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table "ba_verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "ba_organization" ("id" text not null primary key, "name" text not null, "slug" text not null unique, "logo" text, "createdAt" timestamptz not null, "metadata" text);

create table "ba_member" ("id" text not null primary key, "organizationId" text not null references "ba_organization" ("id") on delete cascade, "userId" text not null references "ba_user" ("id") on delete cascade, "role" text not null, "createdAt" timestamptz not null);

create table "ba_invitation" ("id" text not null primary key, "organizationId" text not null references "ba_organization" ("id") on delete cascade, "email" text not null, "role" text, "status" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "inviterId" text not null references "ba_user" ("id") on delete cascade);

create table "ba_ssoProvider" ("id" text not null primary key, "issuer" text not null, "oidcConfig" text, "samlConfig" text, "userId" text not null references "ba_user" ("id") on delete cascade, "providerId" text not null unique, "organizationId" text, "domain" text not null, "domainVerified" boolean);

create table "ba_scimConnectionBinding" ("id" text not null primary key, "connectionId" text not null, "connectionKey" text not null unique, "provisioningDomainId" text not null, "createdAt" timestamptz not null, "decommissionedAt" timestamptz, "decommissionStatus" text not null, "decommissionCursorUserId" text, "decommissionReconciledUserCount" integer not null, "decommissionBatchCount" integer not null, "decommissionRevision" integer not null, "decommissionCompletedAt" timestamptz, "decommissionLeaseId" text, "decommissionLeaseExpiresAt" timestamptz);

create table "ba_scimIdentityTombstone" ("id" text not null primary key, "connectionId" text not null, "provisioningDomainId" text not null, "externalId" text not null, "externalIdKey" text not null unique, "userId" text not null references "ba_user" ("id") on delete cascade, "profile" text not null, "deletedAt" timestamptz not null);

create table "ba_scimSubject" ("id" text not null primary key, "userId" text not null unique references "ba_user" ("id") on delete cascade, "profileSourceId" text, "revision" integer not null, "createdAt" timestamptz not null, "updatedAt" timestamptz not null);

create table "ba_scimUser" ("id" text not null primary key, "connectionId" text not null, "provisioningDomainId" text not null, "userId" text not null references "ba_user" ("id") on delete cascade, "connectionUserKey" text not null unique, "userName" text not null, "userNameKey" text not null unique, "primaryEmail" text not null, "workEmailValueIndex" text not null, "emailValueIndex" text not null, "displayName" text not null, "formattedName" text not null, "givenName" text, "familyName" text, "serializedEmails" text not null, "serializedAttributes" text, "externalId" text, "externalIdKey" text unique, "active" boolean not null, "orderKey" text not null unique, "createdAt" timestamptz not null, "updatedAt" timestamptz not null);

create table "ba_scimProjectionGrant" ("id" text not null primary key, "connectionId" text not null, "provisioningDomainId" text not null, "scimUserId" text not null references "ba_scimUser" ("id") on delete cascade, "userId" text not null references "ba_user" ("id") on delete cascade, "sourceKind" text not null, "sourceId" text not null, "sourceValue" text, "role" text not null, "grantKey" text not null unique, "createdAt" timestamptz not null, "updatedAt" timestamptz not null);

create table "ba_scimGroup" ("id" text not null primary key, "connectionId" text not null, "provisioningDomainId" text not null, "revision" integer not null, "displayName" text not null, "displayNameKey" text not null unique, "externalId" text, "externalIdKey" text unique, "orderKey" text not null unique, "createdAt" timestamptz not null, "updatedAt" timestamptz not null);

create table "ba_scimGroupMember" ("id" text not null primary key, "connectionId" text not null, "groupId" text not null references "ba_scimGroup" ("id") on delete cascade, "scimUserId" text not null references "ba_scimUser" ("id") on delete cascade, "membershipKey" text not null unique, "createdAt" timestamptz not null);

create table "ba_rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "ba_session_userId_idx" on "ba_session" ("userId");

create index "ba_account_userId_idx" on "ba_account" ("userId");

create index "ba_verification_identifier_idx" on "ba_verification" ("identifier");

create index "ba_member_organizationId_idx" on "ba_member" ("organizationId");

create index "ba_member_userId_idx" on "ba_member" ("userId");

create index "ba_invitation_organizationId_idx" on "ba_invitation" ("organizationId");

create index "ba_invitation_email_idx" on "ba_invitation" ("email");

create index "ba_scimConnectionBinding_connectionId_idx" on "ba_scimConnectionBinding" ("connectionId");

create index "ba_scimIdentityTombstone_connectionId_idx" on "ba_scimIdentityTombstone" ("connectionId");

create index "ba_scimIdentityTombstone_provisioningDomainId_idx" on "ba_scimIdentityTombstone" ("provisioningDomainId");

create index "ba_scimIdentityTombstone_userId_idx" on "ba_scimIdentityTombstone" ("userId");

create index "ba_scimSubject_profileSourceId_idx" on "ba_scimSubject" ("profileSourceId");

create index "ba_scimUser_connectionId_idx" on "ba_scimUser" ("connectionId");

create index "ba_scimUser_provisioningDomainId_idx" on "ba_scimUser" ("provisioningDomainId");

create index "ba_scimUser_userId_idx" on "ba_scimUser" ("userId");

create index "ba_scimProjectionGrant_connectionId_idx" on "ba_scimProjectionGrant" ("connectionId");

create index "ba_scimProjectionGrant_provisioningDomainId_idx" on "ba_scimProjectionGrant" ("provisioningDomainId");

create index "ba_scimProjectionGrant_scimUserId_idx" on "ba_scimProjectionGrant" ("scimUserId");

create index "ba_scimProjectionGrant_userId_idx" on "ba_scimProjectionGrant" ("userId");

create index "ba_scimGroup_connectionId_idx" on "ba_scimGroup" ("connectionId");

create index "ba_scimGroup_provisioningDomainId_idx" on "ba_scimGroup" ("provisioningDomainId");

create index "ba_scimGroupMember_connectionId_idx" on "ba_scimGroupMember" ("connectionId");

create index "ba_scimGroupMember_groupId_idx" on "ba_scimGroupMember" ("groupId");

create index "ba_scimGroupMember_scimUserId_idx" on "ba_scimGroupMember" ("scimUserId");
