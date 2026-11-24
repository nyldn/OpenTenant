
create schema hello;
create table hello.greetings (tenant_id text not null, greeting text not null);
alter table hello.greetings enable row level security;
alter table hello.greetings force row level security;
create policy tenant_isolation on hello.greetings
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant usage on schema hello to tenant_app;
grant select, insert on hello.greetings to tenant_app;
