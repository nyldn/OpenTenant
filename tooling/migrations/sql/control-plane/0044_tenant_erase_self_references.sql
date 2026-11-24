-- Delete self-referencing correction rows together with their tenant scope.
-- Explicit, owner-only destructive procedure. Normal writes retain all immutable
-- evidence guards. ALTER TABLE holds an exclusive lock until this transaction
-- ends; trigger changes and deletes roll back together on any error.
create or replace function tenant_erase_rows(target regclass, predicate text, tenant text, depth integer default 0)
returns void language plpgsql set search_path = pg_catalog, public as $$
declare fk record; child_columns text; parent_columns text; has_rows boolean;
begin
  execute format('select exists(select 1 from %s where %s)',target,predicate) into has_rows using tenant;
  if not has_rows then return; end if;
  if depth > 24 then raise exception 'tenant erase dependency cycle'; end if;
  for fk in select c.conrelid, c.conkey, c.confkey from pg_constraint c
    where c.contype='f' and c.confrelid=target and c.conrelid<>target order by c.conrelid
  loop
    select string_agg(format('%I', a.attname), ',' order by k.ordinality)
      into child_columns from unnest(fk.conkey) with ordinality k(num,ordinality)
      join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k.num;
    select string_agg(format('%I', a.attname), ',' order by k.ordinality)
      into parent_columns from unnest(fk.confkey) with ordinality k(num,ordinality)
      join pg_attribute a on a.attrelid=target and a.attnum=k.num;
    perform public.tenant_erase_rows(fk.conrelid,
      format('(%s) in (select %s from %s where %s)',child_columns,parent_columns,target,predicate),tenant,depth+1);
  end loop;
  execute format('alter table %s disable trigger user',target);
  execute format('delete from %s where %s',target,predicate) using tenant;
  execute format('alter table %s enable trigger user',target);
end;
$$;

-- Replay guards and other tenant-scoped tables can intentionally have no FK.
-- Include those rows as well as the FK closure, without disabling any guard
-- outside this owner-only transaction.
create or replace function hard_erase_tenant(tenant text) returns void
language plpgsql set search_path = pg_catalog, public as $$
declare scope record;
begin
  perform 1 from public.tenants where tenant_id=tenant and status='deleted'
    and erase_after <= now() and database_erased_at is not null for update;
  if not found then raise exception 'tenant not ready for hard erase'; end if;
  if exists(select 1 from public.module_catalog m join public.tenant_modules tm using(module_key)
    where m.owner_tenant_id=tenant and tm.tenant_id<>tenant) then
    raise exception 'retire shared tenant-owned modules before erase';
  end if;
  for scope in select c.oid::regclass as relation,a.attname as column_name
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid
    where n.nspname='public' and c.relkind='r' and c.relname<>'tenants'
      and a.attname in ('tenant_id','owner_tenant_id') and not a.attisdropped
    order by c.oid,a.attnum
  loop
    perform public.tenant_erase_rows(scope.relation,format('%I=$1',scope.column_name),tenant);
  end loop;
  perform public.tenant_erase_rows('public.tenants'::regclass,'tenant_id=$1',tenant);
end;
$$;
