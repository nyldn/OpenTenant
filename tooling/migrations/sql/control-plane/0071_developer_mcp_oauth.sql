-- Clients and projects are explicitly registered by an installation owner.
create table developer_mcp.oauth_clients (
 client_id text primary key, redirect_uri text not null
);
create table developer_mcp.oauth_codes (
 digest text primary key, project_id text not null references developer_mcp.projects(id),
 client_id text not null references developer_mcp.oauth_clients(client_id),
 redirect_uri text not null, resource text not null, challenge text not null,
 expires_at timestamptz not null, consumed boolean not null default false
);
