-- Immutable evidence, atomic completion and privileged content retention.
create function support.ai_immutable() returns trigger language plpgsql as $$
begin raise exception 'support AI evidence is immutable' using errcode='42501'; end $$;
create function support.ai_epoch() returns trigger language plpgsql as $$
begin
  if not has_column_privilege(current_user, 'support.ai_controls', 'enabled', 'UPDATE') then
    raise exception 'support AI controls require operator authority' using errcode='42501';
  end if;
  new.epoch := old.epoch + 1; return new; end $$;
create trigger ai_controls_epoch before update on support.ai_controls for each row execute function support.ai_epoch();
create function support.ai_completion_guard() returns trigger language plpgsql as $$
declare r support.ai_suggestion_requests;
begin
  select * into r from support.ai_suggestion_requests where tenant_id=new.tenant_id and id=new.request_id for update;
  if not found or clock_timestamp() >= r.execution_deadline or exists
    (select 1 from support.ai_suggestion_terminals where tenant_id=new.tenant_id and request_id=new.request_id) then
    raise exception 'support AI request already finished or interrupted' using errcode='23514';
  end if;
  return new;
end $$;
create trigger ai_terminal_deadline before insert on support.ai_suggestion_terminals for each row execute function support.ai_completion_guard();
create trigger ai_suggestion_deadline before insert on support.ai_suggestions for each row execute function support.ai_completion_guard();
create function support.ai_artifact_guard() returns trigger language plpgsql as $$
begin
  if exists(select 1 from jsonb_object_keys(new.artifact) k where k not in ('category','priority','reply','claims','segments','sources','schemaVersion')) or
    new.artifact->>'category' not in ('bug_report','feature_request','how_to','account_issue','billing','other') or
    new.artifact->>'priority' not in ('low','medium','high','urgent') or
    jsonb_typeof(new.artifact->'reply') is distinct from 'string' or length(new.artifact->>'reply') not between 1 and 10000 or
    jsonb_typeof(new.artifact->'claims') is distinct from 'array' or jsonb_array_length(new.artifact->'claims') not between 1 and 64 or
    new.artifact->>'schemaVersion' is distinct from '1' or
    new.artifact_digest <> encode(sha256(convert_to(new.artifact::text,'UTF8')),'hex') then
    raise exception 'invalid support AI artifact' using errcode='23514';
  end if;
  return new;
end $$;
create trigger ai_artifact_valid before insert on support.ai_suggestions for each row execute function support.ai_artifact_guard();
create function support.ai_atomic_evidence() returns trigger language plpgsql as $$
declare action_name text;
begin
  action_name := case tg_table_name
    when 'ai_suggestion_requests' then 'requested'
    when 'ai_suggestion_policy_snapshots' then 'policy_resolved'
    when 'ai_suggestion_attempts' then 'provider_started'
    when 'ai_suggestions' then 'suggestion_created'
    when 'ai_suggestion_terminals' then case when to_jsonb(new)->>'kind'='review_required' then 'suggestion_created' else 'terminal' end
    when 'ai_suggestion_reviews' then to_jsonb(new)->>'decision' end;
  if not exists(select 1 from support.ai_suggestion_audit_events where tenant_id=new.tenant_id and
    request_id=coalesce(to_jsonb(new)->>'request_id',to_jsonb(new)->>'id')::uuid and action=action_name) then
    raise exception 'support AI audit evidence required' using errcode='23514';
  end if;
  if tg_table_name='ai_suggestions' then
    if not exists(select 1 from support.ai_suggestion_terminals where tenant_id=new.tenant_id and request_id=new.request_id and
      suggestion_id=new.id and artifact_digest=new.artifact_digest and kind='review_required') or
      not exists(select 1 from support.ai_suggestion_attempts where tenant_id=new.tenant_id and request_id=new.request_id and attempt->>'terminal'='started') then
      raise exception 'support AI completed inference required' using errcode='23514';
    end if;
  elsif tg_table_name='ai_suggestion_terminals' then
    if new.kind='review_required' and not exists(select 1 from support.ai_suggestions where tenant_id=new.tenant_id and request_id=new.request_id and id=new.suggestion_id and artifact_digest=new.artifact_digest) then
      raise exception 'support AI suggestion evidence required' using errcode='23514';
    end if;
  elsif tg_table_name='ai_suggestion_reviews' then
    if not exists(select 1 from support.ai_suggestions where tenant_id=new.tenant_id and request_id=new.request_id and id=new.suggestion_id) then
      raise exception 'support AI review mismatch' using errcode='23503';
    end if;
  end if;
  return null;
end $$;
create function support.ai_content_delete() returns trigger language plpgsql as $$
begin
  if exists(select 1 from support.ai_suggestion_requests r join support.tickets t on t.tenant_id=r.tenant_id and t.id=r.ticket_id
    where r.tenant_id=old.tenant_id and r.id=old.request_id and clock_timestamp()<r.retention_until) then
    raise exception 'support AI content is still retained' using errcode='42501';
  end if;
  return old;
end $$;
create trigger ai_content_retention before delete on support.ai_suggestions for each row execute function support.ai_content_delete();
-- Caller must be the separately privileged retention operator. No application grant.
create function support.purge_ai_suggestion_content() returns bigint language plpgsql as $$
declare removed bigint;
begin
  delete from support.ai_suggestions s using support.ai_suggestion_requests r
    where s.tenant_id=r.tenant_id and s.request_id=r.id and
      (r.retention_until<=clock_timestamp() or not exists(select 1 from support.tickets t where t.tenant_id=r.tenant_id and t.id=r.ticket_id));
  get diagnostics removed = row_count;
  return removed;
end $$;
revoke all on function support.purge_ai_suggestion_content() from public, tenant_app;
create trigger ai_suggestion_requests_immutable before update or delete on support.ai_suggestion_requests for each row execute function support.ai_immutable();
create trigger ai_suggestion_requests_no_truncate before truncate on support.ai_suggestion_requests for each statement execute function support.ai_immutable();
create constraint trigger ai_suggestion_requests_audit after insert on support.ai_suggestion_requests deferrable initially deferred for each row execute function support.ai_atomic_evidence();
create trigger ai_suggestion_policy_snapshots_immutable before update or delete on support.ai_suggestion_policy_snapshots for each row execute function support.ai_immutable();
create trigger ai_suggestion_policy_snapshots_no_truncate before truncate on support.ai_suggestion_policy_snapshots for each statement execute function support.ai_immutable();
create constraint trigger ai_suggestion_policy_snapshots_audit after insert on support.ai_suggestion_policy_snapshots deferrable initially deferred for each row execute function support.ai_atomic_evidence();
create trigger ai_suggestion_attempts_immutable before update or delete on support.ai_suggestion_attempts for each row execute function support.ai_immutable();
create trigger ai_suggestion_attempts_no_truncate before truncate on support.ai_suggestion_attempts for each statement execute function support.ai_immutable();
create constraint trigger ai_suggestion_attempts_audit after insert on support.ai_suggestion_attempts deferrable initially deferred for each row execute function support.ai_atomic_evidence();
create trigger ai_suggestions_immutable before update on support.ai_suggestions for each row execute function support.ai_immutable();
create trigger ai_suggestions_no_truncate before truncate on support.ai_suggestions for each statement execute function support.ai_immutable();
create constraint trigger ai_suggestions_audit after insert on support.ai_suggestions deferrable initially deferred for each row execute function support.ai_atomic_evidence();
create trigger ai_suggestion_terminals_immutable before update or delete on support.ai_suggestion_terminals for each row execute function support.ai_immutable();
create trigger ai_suggestion_terminals_no_truncate before truncate on support.ai_suggestion_terminals for each statement execute function support.ai_immutable();
create constraint trigger ai_suggestion_terminals_audit after insert on support.ai_suggestion_terminals deferrable initially deferred for each row execute function support.ai_atomic_evidence();
create trigger ai_suggestion_reviews_immutable before update or delete on support.ai_suggestion_reviews for each row execute function support.ai_immutable();
create trigger ai_suggestion_reviews_no_truncate before truncate on support.ai_suggestion_reviews for each statement execute function support.ai_immutable();
create constraint trigger ai_suggestion_reviews_audit after insert on support.ai_suggestion_reviews deferrable initially deferred for each row execute function support.ai_atomic_evidence();
create trigger ai_suggestion_audit_events_immutable before update or delete on support.ai_suggestion_audit_events for each row execute function support.ai_immutable();
create trigger ai_suggestion_audit_events_no_truncate before truncate on support.ai_suggestion_audit_events for each statement execute function support.ai_immutable();
insert into tenant_core.module_schema_versions(tenant_id,module_key,version) select tenant_id,'support','0010_support_ai_review_guards' from tenant_core.tenant_meta on conflict(tenant_id,module_key) do update set version=excluded.version,applied_at=now();
-- PostgreSQL row locks require UPDATE on at least one column. Triggers still
-- reject every application update; these column grants permit locking only.
grant update(id) on support.ai_suggestion_requests to tenant_app;
grant update(epoch) on support.ai_controls to tenant_app;
-- Canonical knowledge changes revoke existing artifacts on the write path.
-- Republishing identical content cannot revive an older request epoch.
create function support.ai_revoke_knowledge() returns trigger language plpgsql security definer
set search_path = pg_catalog, support as $$
begin
  update support.ai_controls set epoch=epoch where tenant_id=old.tenant_id;
  return null;
end $$;
revoke all on function support.ai_revoke_knowledge() from public, tenant_app;
create trigger ai_knowledge_revocation after update of title,content,status or delete on support.knowledge_articles
  for each row execute function support.ai_revoke_knowledge();
create function support.ai_metadata_guard() returns trigger language plpgsql as $$
declare item jsonb; names text[]; expected text[]; p jsonb;
begin
  if tg_table_name='ai_suggestion_requests' then
    for item in select value from jsonb_array_elements(new.sources) loop
      select array_agg(k order by k) into names from jsonb_object_keys(item) k;
      if names is distinct from array['articleId','chunkId','digest'] or item->>'articleId' !~ '^[a-fA-F0-9-]{36}$' or
        item->>'digest' !~ '^[a-f0-9]{64}$' or length(item->>'chunkId') not between 1 and 128 then
        raise exception 'invalid support AI source reference' using errcode='23514';
      end if;
    end loop;
    return new;
  end if;
  if tg_table_name='ai_suggestion_policy_snapshots' then
    item:=new.policy;
    expected:=array['allowlistVersion','consentId','consentPolicyVersion','model','preparationId','processingBasis','provider','region','retentionPosture','source'];
    if item->>'preparationId' is distinct from new.preparation_id::text or
      not ((item->>'processingBasis'='tenant_region' and item->'consentId'='null'::jsonb and item->'consentPolicyVersion'='null'::jsonb) or
        (item->>'processingBasis'='cross_border_consent' and length(item->>'consentId') between 1 and 128 and length(item->>'consentPolicyVersion') between 1 and 128)) then
      raise exception 'invalid support AI processing basis' using errcode='23514';
    end if;
  else
    item:=new.attempt;
    expected:=array['allowlistVersion','credentialOrigin','evidenceOrigin','executionId','model','moduleId','preparationId','provider','region','retentionPosture','tenantId','terminal','useCase'];
    select policy into p from support.ai_suggestion_policy_snapshots where tenant_id=new.tenant_id and request_id=new.request_id;
    if item->>'preparationId' is distinct from new.preparation_id::text or item->>'executionId' is distinct from new.execution_id::text or
      item->>'tenantId' is distinct from new.tenant_id or item->>'moduleId' is distinct from 'support' or item->>'useCase' is distinct from 'reviewed-suggestion' or
      item->>'credentialOrigin' not in ('tenant','installation') or item->>'evidenceOrigin' not in ('router','synthetic') or item->>'terminal' is distinct from 'started' or
      item->>'provider' is distinct from p->>'provider' or item->>'model' is distinct from p->>'model' or
      item->>'region' is distinct from p->>'region' or item->>'retentionPosture' is distinct from p->>'retentionPosture' or
      item->>'allowlistVersion' is distinct from p->>'allowlistVersion' or new.execution_id=new.preparation_id then
      raise exception 'invalid support AI attempt link' using errcode='23514';
    end if;
  end if;
  select array_agg(k order by k) into names from jsonb_object_keys(item) k;
  if names is distinct from expected or exists(select 1 from jsonb_each(item) e where jsonb_typeof(e.value) not in ('string','null') or length(e.value#>>'{}')>128) or
    item->>'provider' !~ '^[A-Za-z0-9._:-]{1,128}$' or item->>'model' !~ '^[A-Za-z0-9._:/-]{1,128}$' or
    item->>'region' not in ('us','eu','ap') or item->>'retentionPosture' not in ('zero_retention','provider_default','unverified') then
    raise exception 'invalid support AI inference metadata' using errcode='23514';
  end if;
  return new;
end $$;
create trigger ai_sources_valid before insert on support.ai_suggestion_requests for each row execute function support.ai_metadata_guard();
create trigger ai_policy_valid before insert on support.ai_suggestion_policy_snapshots for each row execute function support.ai_metadata_guard();
create trigger ai_attempt_valid before insert on support.ai_suggestion_attempts for each row execute function support.ai_metadata_guard();
create trigger ai_policy_deadline before insert on support.ai_suggestion_policy_snapshots for each row execute function support.ai_completion_guard();
create trigger ai_attempt_deadline before insert on support.ai_suggestion_attempts for each row execute function support.ai_completion_guard();
