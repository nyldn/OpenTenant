/** Forward migration 0070 payload. Integrator must register with the canonical runner. No request runs DDL. */
export const DEVELOPER_MCP_SCHEMA = `
create schema developer_mcp;
create table developer_mcp.switches (scope text primary key, enabled boolean not null default false);
create table developer_mcp.projects (
 id text primary key check (id ~ '^[0-9a-f]{32}$'), tenant_id text not null references tenants(tenant_id),
 user_id text not null, client_id text not null,
 profile text not null check (profile in ('developer.readonly@1','developer.builder@1')),
 consent_scopes text[] not null check (consent_scopes <@ array['module.dev.workspace.read','module.dev.workspace.create','module.dev.workspace.lifecycle','module.dev.contract.read','module.dev.evidence.read','module.dev.build.execute','module.dev.preview.open']::text[]),
 active boolean not null default false, unique(id,tenant_id)
);
create table developer_mcp.tokens (
 digest text primary key check (digest ~ '^[0-9a-f]{64}$'), project_id text not null references developer_mcp.projects(id),
 audience text not null, scopes text[] not null check (scopes <@ array['module.dev.workspace.read','module.dev.workspace.create','module.dev.workspace.lifecycle','module.dev.contract.read','module.dev.evidence.read','module.dev.build.execute','module.dev.preview.open']::text[]),
 expires_at timestamptz not null, revoked boolean not null default false
);
create table developer_mcp.confirmations (
 digest text primary key, tenant_id text not null references tenants(tenant_id), user_id text not null, client_id text not null,
 project_id text not null references developer_mcp.projects(id), input_digest text not null,
 tool text not null check(tool='workspace.create'), expires_at timestamptz not null, consumed boolean not null default false
);
create table developer_mcp.jobs (
 id text primary key, tenant_id text not null references tenants(tenant_id), project_id text not null references developer_mcp.projects(id),
 user_id text not null, client_id text not null, input_digest text not null, lease_id text not null,
 expires_at timestamptz not null, status text not null check(status in ('running','complete','failed')), created_at timestamptz not null default now()
);
create table developer_mcp.previews (
 digest text primary key, job_id text not null references developer_mcp.jobs(id),
 tenant_id text not null references tenants(tenant_id), user_id text not null, client_id text not null,
 html text not null check(octet_length(html)<=16384), expires_at timestamptz not null, consumed boolean not null default false
);
-- Missing switches deny. There are deliberately no enabled seed rows.
`;
