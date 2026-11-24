-- R7 reservation: docs/plans/migration-reservations.md, 0090-0091.
-- Control-plane stores bind tenants explicitly, as module ownership and R2 do.
-- Owner decision 2026-11-17: ordinary writes are insert-only for the tenant's
-- lifetime. Existing owner-only tenant_erase_rows relaxes these user triggers
-- transactionally during authorized hard erasure and follows the foreign keys.
alter table module_versions add constraint module_versions_exact_artifact
  unique (module_key, version, artifact_digest);

create table module_quality_contracts (
  contract_record_id uuid primary key,
  submission_id uuid not null,
  tenant_id text not null references tenants (tenant_id) on delete restrict,
  module_key text not null,
  module_version text not null,
  artifact_digest text not null check (artifact_digest ~ '^[a-f0-9]{64}$'),
  contract_id text not null,
  contract_version integer not null check (contract_version > 0),
  contract_body jsonb not null check (octet_length(contract_body::text) <= 1048576),
  contract_digest text not null check (contract_digest ~ '^[a-f0-9]{64}$'),
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  recorded_by_user_id text not null references platform_users (user_id),
  recorded_at timestamptz not null,
  reason text not null check (reason = btrim(reason) and length(reason) between 1 and 512),
  audit_sequence bigint not null,
  unique (tenant_id, submission_id),
  unique (tenant_id, module_key, module_version, artifact_digest),
  unique (contract_record_id, tenant_id, module_key, module_version, artifact_digest),
  foreign key (module_key, module_version, artifact_digest)
    references module_versions (module_key, version, artifact_digest) on delete restrict,
  foreign key (tenant_id, audit_sequence) references audit_events (tenant_id, sequence),
  check (jsonb_typeof(contract_body) = 'object'
    and contract_body ?& array['moduleId','contractId','version']
    and contract_body->>'moduleId' = module_key
    and contract_body->>'contractId' = contract_id
    and contract_body->'version' = to_jsonb(contract_version))
);
create index module_quality_contract_logical on module_quality_contracts
  (tenant_id, module_key, contract_id, contract_version);

-- The versioned JSON envelope contains all runs, effective contract, result and
-- their individual digests. Composite keys carry the relational artifact proof.
create table module_quality_evaluations (
  evaluation_id uuid primary key,
  submission_id uuid not null,
  tenant_id text not null references tenants (tenant_id) on delete restrict,
  module_key text not null,
  module_version text not null,
  artifact_digest text not null,
  contract_record_id uuid not null,
  baseline_module_version text not null,
  baseline_artifact_digest text not null,
  baseline_contract_record_id uuid not null,
  evaluator_version text not null check (evaluator_version = 'quality-contract.phase0.v1'),
  evidence_body jsonb not null check (octet_length(evidence_body::text) <= 7340032),
  evidence_digest text not null check (evidence_digest ~ '^[a-f0-9]{64}$'),
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  recorded_by_user_id text not null references platform_users (user_id),
  recorded_at timestamptz not null,
  reason text not null check (reason = btrim(reason) and length(reason) between 1 and 512),
  audit_sequence bigint not null,
  unique (tenant_id, submission_id),
  unique (tenant_id, evidence_digest),
  foreign key (contract_record_id, tenant_id, module_key, module_version, artifact_digest)
    references module_quality_contracts (contract_record_id, tenant_id, module_key, module_version, artifact_digest),
  foreign key (baseline_contract_record_id, tenant_id, module_key, baseline_module_version, baseline_artifact_digest)
    references module_quality_contracts (contract_record_id, tenant_id, module_key, module_version, artifact_digest),
  foreign key (tenant_id, audit_sequence) references audit_events (tenant_id, sequence),
  check (contract_record_id <> baseline_contract_record_id
    and module_version <> baseline_module_version and artifact_digest <> baseline_artifact_digest),
  check (jsonb_typeof(evidence_body) = 'object'
    and evidence_body ?& array['evaluatorVersion','baseline','candidate','result','baselineRun','candidateRun','effectiveContract','effectiveContractDigest']
    and evidence_body->>'evaluatorVersion' = evaluator_version
    and evidence_body->'candidate' = jsonb_build_object('tenantId', tenant_id, 'moduleKey', module_key, 'moduleVersion', module_version, 'artifactDigest', artifact_digest)
    and evidence_body->'baseline' = jsonb_build_object('tenantId', tenant_id, 'moduleKey', module_key, 'moduleVersion', baseline_module_version, 'artifactDigest', baseline_artifact_digest)
    and (evidence_body->'effectiveContract' = 'null'::jsonb) = (evidence_body->'effectiveContractDigest' = 'null'::jsonb)
    and evidence_body->'result'->>'verdict' in ('accepted','rejected','no_change'))
);

create function enforce_quality_evidence_insert() returns trigger language plpgsql as $$
declare
  event audit_events%rowtype;
  expected_action text;
  expected_detail jsonb;
  record_id uuid;
  body_digest text;
begin
  -- Same tenant lock as PgAuditStore, including direct SQL logical-ID checks.
  perform pg_advisory_xact_lock(hashtext(new.tenant_id));
  perform 1 from module_catalog c join module_versions v on v.module_key=c.module_key
    join installation_metadata i on i.singleton and i.installation_id=c.installation_id
    where c.module_key=new.module_key and c.ownership_scope='tenant' and c.owner_tenant_id=new.tenant_id
      and v.version=new.module_version and v.artifact_digest=new.artifact_digest and v.digest_kind='sha256_artifact'
    for share of c, v, i;
  if not found then raise exception 'quality evidence ownership or artifact mismatch'; end if;

  if tg_table_name = 'module_quality_contracts' then
    if exists (select 1 from module_quality_contracts c
      where c.tenant_id=new.tenant_id and c.module_key=new.module_key
        and c.contract_id=new.contract_id and c.contract_version=new.contract_version
        and (c.contract_body <> new.contract_body or c.contract_digest <> new.contract_digest)) then
      raise exception 'quality contract logical version is immutable';
    end if;
    expected_action := 'quality.contract.recorded';
    record_id := new.contract_record_id;
    body_digest := new.contract_digest;
  else
    expected_action := 'quality.evaluation.recorded';
    record_id := new.evaluation_id;
    body_digest := new.evidence_digest;
  end if;
  expected_detail := jsonb_build_object('recordId', record_id::text, 'moduleKey', new.module_key,
    'moduleVersion', new.module_version, 'artifactDigest', new.artifact_digest,
    'digest', body_digest, 'requestDigest', new.request_digest, 'reason', new.reason);
  if tg_table_name = 'module_quality_evaluations' then
    expected_detail := expected_detail || jsonb_build_object(
      'baselineContractRecordId', new.baseline_contract_record_id::text,
      'contractRecordId', new.contract_record_id::text,
      'baselineModuleVersion', new.baseline_module_version,
      'baselineArtifactDigest', new.baseline_artifact_digest,
      'evaluatorVersion', new.evaluator_version, 'verdict', new.evidence_body->'result'->>'verdict');
  end if;
  select * into event from audit_events where tenant_id=new.tenant_id and sequence=new.audit_sequence
    and xmin = pg_current_xact_id()::xid;
  if not found or event.action <> expected_action or event.subject <> new.module_key
    or event.occurred_at <> new.recorded_at
    or event.actor <> jsonb_build_object('kind','user','userId',new.recorded_by_user_id)
    or event.detail <> expected_detail then
    raise exception 'quality evidence requires its exact atomic audit event';
  end if;
  return new;
end;
$$;
create trigger module_quality_contracts_insert before insert on module_quality_contracts
  for each row execute function enforce_quality_evidence_insert();
create trigger module_quality_evaluations_insert before insert on module_quality_evaluations
  for each row execute function enforce_quality_evidence_insert();
-- Fire only when evidence would actually change: row-level for UPDATE and
-- DELETE, and TRUNCATE only of a non-empty table. Statements that touch no
-- quality rows (for example an unrelated cascade) are not blocked.
create function quality_evidence_block_mutation() returns trigger language plpgsql as $$
declare has_rows boolean;
begin
  if tg_op = 'TRUNCATE' then
    execute format('select exists(select 1 from %I.%I)', tg_table_schema, tg_table_name) into has_rows;
    if not has_rows then return null; end if;
  end if;
  raise exception 'quality evidence is insert-only';
end;
$$;
create trigger module_quality_contracts_immutable before update or delete on module_quality_contracts
  for each row execute function quality_evidence_block_mutation();
create trigger module_quality_contracts_no_truncate before truncate on module_quality_contracts
  for each statement execute function quality_evidence_block_mutation();
create trigger module_quality_evaluations_immutable before update or delete on module_quality_evaluations
  for each row execute function quality_evidence_block_mutation();
create trigger module_quality_evaluations_no_truncate before truncate on module_quality_evaluations
  for each statement execute function quality_evidence_block_mutation();
comment on table module_quality_contracts is 'Explicit tenant-bound artifact contracts, insert-only until authorized tenant erasure; all store reads bind tenant and verify owner.';
comment on table module_quality_evaluations is 'Explicit tenant-bound Phase 0 evidence, insert-only until authorized tenant erasure; no publication or authorization effect.';
