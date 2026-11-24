-- R7: quality lineage reaches the existing catalog/version FK cycle. Keep all
-- foreign keys and the four-argument owner-only entry point. Collect disabled
-- guards until the complete root deletion resolves the deferred catalog FK.
create function tenant_erase_rows_path(
  target regclass, predicate text, tenant text, depth integer, visited oid[]
) returns oid[] language plpgsql set search_path = pg_catalog, public as $$
declare
  fk record; child_columns text; parent_columns text; has_rows boolean;
  guarded oid[] := array[]::oid[];
begin
  if target::oid = any(visited) then return guarded; end if;
  if depth > 24 then raise exception 'tenant erase dependency cycle'; end if;
  execute format('select exists(select 1 from %s where %s)',target,predicate) into has_rows using tenant;
  if not has_rows then return guarded; end if;
  visited := array_append(visited,target::oid);
  -- Disable before descending. A child delete may queue a deferred FK event on
  -- this relation, after which PostgreSQL refuses ALTER TABLE until it is checked.
  execute format('alter table %s disable trigger user',target);
  guarded := array_append(guarded,target::oid);
  for fk in select c.conrelid, c.conkey, c.confkey from pg_constraint c
    where c.contype='f' and c.confrelid=target and c.conrelid<>target order by c.conrelid
  loop
    -- The outer invocation deletes this relation. Avoid expanding cyclic SQL.
    if fk.conrelid = any(visited) then continue; end if;
    select string_agg(format('%I', a.attname), ',' order by k.ordinality)
      into child_columns from unnest(fk.conkey) with ordinality k(num,ordinality)
      join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k.num;
    select string_agg(format('%I', a.attname), ',' order by k.ordinality)
      into parent_columns from unnest(fk.confkey) with ordinality k(num,ordinality)
      join pg_attribute a on a.attrelid=target and a.attnum=k.num;
    guarded := guarded || public.tenant_erase_rows_path(fk.conrelid,
      format('(%s) in (select %s from %s where %s)',child_columns,parent_columns,target,predicate),tenant,depth+1,visited);
  end loop;
  execute format('delete from %s where %s',target,predicate) using tenant;
  return guarded;
end;
$$;
revoke all on function tenant_erase_rows_path(regclass,text,text,integer,oid[]) from public;

create or replace function tenant_erase_rows(target regclass, predicate text, tenant text, depth integer default 0)
returns void language plpgsql set search_path = pg_catalog, public as $$
declare guarded oid[]; relation regclass;
begin
  -- This FK is initially deferred in 0014. Check it before restoring guards,
  -- then restore its normal mode. Other unresolved cycles fail closed.
  set constraints public.module_catalog_initial_version_fkey deferred;
  guarded := public.tenant_erase_rows_path(target,predicate,tenant,depth,array[]::oid[]);
  set constraints public.module_catalog_initial_version_fkey immediate;
  for relation in select distinct unnest(guarded)::regclass loop
    execute format('alter table %s enable trigger user',relation);
  end loop;
  set constraints public.module_catalog_initial_version_fkey deferred;
end;
$$;
revoke all on function tenant_erase_rows(regclass,text,text,integer) from public;
