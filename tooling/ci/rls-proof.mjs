/**
 * Exhaustive fail-closed RLS proof, run in CI against an ephemeral PostgreSQL
 * service. The database and tenant data used here must always be disposable
 * and synthetic. The script refuses a database that already has application
 * schemas or a cluster that already has tenant_app; it never drops schemas.
 *
 * Usage: DATABASE_URL=<owner uri> node tooling/ci/rls-proof.mjs
 */
import pg from "pg";
import "../migrations/src/register.mjs";
const productionMigrationPath = "../provisioning/src/tenant-database.ts";
const productionRolePath = "../provisioning/src/app-role.ts";
const { prepareTenantDatabase } = await import(productionMigrationPath);
const { createAppRole } = await import(productionRolePath);

const ownerUrl = process.env.DATABASE_URL;
if (!ownerUrl) {
  console.error("DATABASE_URL (owner connection) is required");
  process.exit(1);
}

const APP_ROLE = "tenant_app";
const TENANT = "ten_ci";
const OTHER_TENANT = "ten_other";
const TENANT_POLICY_EXPRESSION = "(tenant_id = current_setting('app.tenant_id'::text, true))";

const TABLES = [
  { schema: "tenant_core", table: "tenant_meta", expectedRows: 1 },
  { schema: "tenant_core", table: "module_schema_versions", expectedRows: 2 },
  { schema: "brain", table: "entities", expectedRows: 2 },
  { schema: "brain", table: "entity_aliases", expectedRows: 1 },
  { schema: "brain", table: "raw_signals", expectedRows: 1 },
  { schema: "brain", table: "raw_signal_payloads", expectedRows: 1 },
  { schema: "brain", table: "raw_signal_chunks", expectedRows: 1 },
  { schema: "brain", table: "validated_context", expectedRows: 1 },
  { schema: "brain", table: "context_edges", expectedRows: 1 },
  { schema: "brain", table: "decisions_log", expectedRows: 1 },
  { schema: "brain", table: "quarantine", expectedRows: 1 },
  { schema: "support", table: "ai_controls", expectedRows: 1 },
  { schema: "support", table: "ai_suggestion_requests", expectedRows: 1 },
  { schema: "support", table: "ai_suggestion_policy_snapshots", expectedRows: 1 },
  { schema: "support", table: "ai_suggestion_attempts", expectedRows: 1 },
  { schema: "support", table: "ai_suggestions", expectedRows: 1 },
  { schema: "support", table: "ai_suggestion_terminals", expectedRows: 1 },
  { schema: "support", table: "ai_suggestion_reviews", expectedRows: 1 },
  { schema: "support", table: "ai_suggestion_audit_events", expectedRows: 6 },
  { schema: "support", table: "tickets", expectedRows: 1 },
  { schema: "support", table: "ticket_sequences", expectedRows: 1 },
  { schema: "support", table: "messages", expectedRows: 1 },
  { schema: "support", table: "ticket_events", expectedRows: 1 },
  { schema: "support", table: "outbox_events", expectedRows: 1 },
  { schema: "support", table: "delivery_preferences", expectedRows: 1 },
  { schema: "support", table: "delivery_attempts", expectedRows: 1 },
  { schema: "support", table: "email_deliveries", expectedRows: 1 },
  { schema: "support", table: "email_delivery_events", expectedRows: 1 },
  { schema: "support", table: "attachments", expectedRows: 1 },
  { schema: "support", table: "sla_policies", expectedRows: 1 },
  { schema: "support", table: "sla_states", expectedRows: 1 },
  { schema: "support", table: "csat_responses", expectedRows: 1 },
  { schema: "support", table: "depth_events", expectedRows: 1 },
  { schema: "support", table: "canned_responses", expectedRows: 1 },
  { schema: "support", table: "knowledge_articles", expectedRows: 1 },
  { schema: "support", table: "notifications", expectedRows: 1 },
  { schema: "support", table: "slack_app_connections", expectedRows: 1 },
  { schema: "support", table: "slack_app_channels", expectedRows: 1 },
  { schema: "support", table: "slack_ticket_threads", expectedRows: 1 },
  { schema: "support", table: "slack_identity_mappings", expectedRows: 1 },
  { schema: "support", table: "slack_action_receipts", expectedRows: 1 },
];

const IDS = {
  entityA: "00000000-0000-4000-8000-000000000101",
  entityB: "00000000-0000-4000-8000-000000000102",
  alias: "00000000-0000-4000-8000-000000000103",
  signal: "00000000-0000-4000-8000-000000000201",
  chunk: "00000000-0000-4000-8000-000000000301",
  context: "00000000-0000-4000-8000-000000000401",
  edge: "00000000-0000-4000-8000-000000000501",
  quarantine: "00000000-0000-4000-8000-000000000601",
  ticket: "00000000-0000-4000-8000-000000000701",
  message: "00000000-0000-4000-8000-000000000702",
  event: "00000000-0000-4000-8000-000000000703",
  canned: "00000000-0000-4000-8000-000000000704",
  article: "00000000-0000-4000-8000-000000000705",
  notification: "00000000-0000-4000-8000-000000000706",
  deliveryAttempt: "00000000-0000-4000-8000-000000000707",
  attachment: "00000000-0000-4000-8000-000000000708",
};

function qualifiedName({ schema, table }) {
  return `${schema}.${table}`;
}

let failures = 0;
let checks = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

async function expectSqlState(client, name, sql, params = [], expectedCode = "42501") {
  try {
    await client.query(sql, params);
    check(name, false, "statement unexpectedly succeeded");
  } catch (error) {
    const actualCode = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    check(name, actualCode === expectedCode, `expected SQLSTATE ${expectedCode}, received ${actualCode ?? "none"}`);
  }
}

async function setTenant(client, tenantId) {
  await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
}


async function seedSyntheticData(app) {
  await app.query("begin");
  try {
    await setTenant(app, TENANT);
    await app.query(
      `insert into brain.entities (id, tenant_id, kind, canonical_name)
       values ($1, $3, 'person', 'Synthetic One'), ($2, $3, 'team', 'Synthetic Two')`,
      [IDS.entityA, IDS.entityB, TENANT],
    );
    await app.query(
      `insert into brain.entity_aliases (id, tenant_id, entity_id, alias, source)
       values ($1, $2, $3, 'Synthetic Alias', 'ci')`,
      [IDS.alias, TENANT, IDS.entityA],
    );
    await app.query(
      `insert into brain.raw_signals (id, tenant_id, source, source_id, visibility, content_hash)
       values ($1, $2, 'ci', 'signal-1', 'internal', 'synthetic-hash')`,
      [IDS.signal, TENANT],
    );
    await app.query(
      `insert into brain.raw_signal_payloads (raw_signal_id, tenant_id, content_type, payload_text)
       values ($1, $2, 'text/plain', 'synthetic payload')`,
      [IDS.signal, TENANT],
    );
    await app.query(
      `insert into brain.raw_signal_chunks
         (id, tenant_id, raw_signal_id, chunk_index, token_count, content)
       values ($1, $2, $3, 0, 2, 'synthetic chunk')`,
      [IDS.chunk, TENANT, IDS.signal],
    );
    await app.query(
      `insert into brain.validated_context
         (id, tenant_id, entity_id, statement, trust_tier, source_chunk_id)
       values ($1, $2, $3, 'Synthetic statement', 'validated', $4)`,
      [IDS.context, TENANT, IDS.entityA, IDS.chunk],
    );
    await app.query(
      `insert into brain.context_edges
         (id, tenant_id, src_entity_id, dst_entity_id, relation, claim,
          confidence, source_chunk_id, extraction_model)
       values ($1, $2, $3, $4, 'member_of', 'Synthetic claim', 1, $5, 'ci-model')`,
      [IDS.edge, TENANT, IDS.entityA, IDS.entityB, IDS.chunk],
    );
    await app.query(
      `insert into brain.decisions_log
         (tenant_id, sequence, occurred_at, actor, subject, decision, rationale,
          previous_hash, hash)
       values ($1, 1, '2026-01-02T03:04:05Z', '{"kind":"system"}',
               'synthetic subject', 'synthetic decision', 'synthetic rationale',
               'GENESIS', 'synthetic-decision-hash')`,
      [TENANT],
    );
    await app.query(
      `insert into brain.quarantine
         (id, tenant_id, source, source_id, reason, payload_ciphertext, aad)
       values ($1, $2, 'ci', 'quarantine-1', 'synthetic reason',
               'synthetic ciphertext', 'quarantine:' || $2)`,
      [IDS.quarantine, TENANT],
    );
    await app.query(
      `insert into support.tickets
         (id, tenant_id, ticket_number, created_by, subject, description)
       values ($1, $2, 'SUP-000001', 'user_ci', 'Synthetic subject', 'Synthetic description')`,
      [IDS.ticket, TENANT],
    );
    await app.query(
      `insert into support.ticket_sequences (tenant_id, last_number) values ($1, 1)`,
      [TENANT],
    );
    await app.query(
      `insert into support.messages (id, tenant_id, ticket_id, author_id, body)
       values ($1, $2, $3, 'user_ci', 'Synthetic message')`,
      [IDS.message, TENANT, IDS.ticket],
    );
    await app.query(
      `insert into support.ticket_events (id, tenant_id, ticket_id, actor, kind)
       values ($1, $2, $3, '{"kind":"user","userId":"user_ci"}', 'created')`,
      [IDS.event, TENANT, IDS.ticket],
    );
    await app.query(
      `insert into support.outbox_events
         (tenant_id, ticket_id, ticket_number, ticket_version, kind, payload)
       values ($1, $2, 'SUP-000001', 1, 'created',
               '{"schemaVersion":1,"status":"open","priority":"medium","category":"other"}'::jsonb)`,
      [TENANT, IDS.ticket],
    );
    await app.query(
      `insert into support.delivery_preferences
         (tenant_id, subject_id, channel, enabled, destination_ref)
       values ($1, 'user_ci', 'email', true, 'email_destination_ci')`,
      [TENANT],
    );
    await app.query(
      `insert into support.delivery_attempts
         (id, tenant_id, ticket_id, ticket_version, channel, event,
          destination_ref, idempotency_key, status, safe_error_class,
          retry_of, root_attempt_id, attempt_number)
       values
         ($1, $2, $3, 1, 'email', 'created', 'email_destination_ci',
          'ten_ci/SUP-000001/1/email/created', 'delivered', null, null, $1, 1)`,
      [IDS.deliveryAttempt, TENANT, IDS.ticket],
    );
    await app.query(
      `insert into support.email_deliveries
         (tenant_id, ticket_id, ticket_number, ticket_version, event,
          subject_id, destination_ref, idempotency_key)
       values ($1, $2, 'SUP-000001', 1, 'created', 'user_ci',
               'email_destination_ci', 'ten_ci/SUP-000001/1/durable-email')`,
      [TENANT, IDS.ticket],
    );
    await app.query(
      `insert into support.email_delivery_events
         (tenant_id, delivery_id, actor, action, attempt)
       select tenant_id, id, '{"kind":"system","job":"synthetic_email"}'::jsonb,
              'manual_retry', 0
         from support.email_deliveries where tenant_id = $1`,
      [TENANT],
    );
    await app.query(
      `insert into support.attachments
         (id, tenant_id, ticket_id, uploaded_by, file_name, media_type,
          byte_size, object_ref)
       values
         ($1, $2, $3, 'user_ci', 'synthetic.txt', 'text/plain', 128,
          'tenant_object_ci')`,
      [IDS.attachment, TENANT, IDS.ticket],
    );
    await app.query(
      `insert into support.sla_policies
         (tenant_id, priority, first_response_minutes, resolution_minutes)
       values ($1, 'medium', 30, 240)`,
      [TENANT],
    );
    await app.query(
      `insert into support.sla_states
         (tenant_id, ticket_id, state, accumulated_paused_minutes,
          paused_at, last_transition_at)
       values ($1, $2, 'running', 0, null, '2026-01-02T03:04:05Z')`,
      [TENANT, IDS.ticket],
    );
    await app.query(
      `insert into support.csat_responses
         (tenant_id, ticket_id, requester_id, rating, comment)
       values ($1, $2, 'user_ci', 5, 'Synthetic CSAT')`,
      [TENANT, IDS.ticket],
    );
    await app.query(
      `insert into support.depth_events
         (tenant_id, actor_id, action, subject_ref, detail)
       values
         ($1, 'user_ci', 'support.delivery.delivered', 'SUP-000001',
          '{"channel":"email"}'::jsonb)`,
      [TENANT],
    );
    await app.query(
      `insert into support.canned_responses (id, tenant_id, title, body, created_by)
       values ($1, $2, 'Synthetic response', 'Synthetic response body', 'user_ci')`,
      [IDS.canned, TENANT],
    );
    await app.query(
      `insert into support.knowledge_articles
         (id, tenant_id, title, content, category, source_ticket_id, created_by)
       values ($1, $2, 'Synthetic article', 'Synthetic article body', 'ci', $3, 'user_ci')`,
      [IDS.article, TENANT, IDS.ticket],
    );
    await app.query(
      `insert into support.notifications
         (id, tenant_id, user_id, ticket_id, kind, title)
       values ($1, $2, 'user_ci', $3, 'ticket_created', 'Synthetic notification')`,
      [IDS.notification, TENANT, IDS.ticket],
    );
    await app.query(
      `insert into support.slack_app_connections
         (id, installation_id, tenant_id, workspace_ref)
       values ('slkconn_ci', 'inst_ci', $1, 'wsref_ci')`,
      [TENANT],
    );
    await app.query(
      `insert into support.slack_app_channels
         (id, installation_id, tenant_id, connection_id, channel_ref)
       values ('slkchan_ci', 'inst_ci', $1, 'slkconn_ci', 'chanref_ci')`,
      [TENANT],
    );
    await app.query(
      `insert into support.slack_ticket_threads
         (id, installation_id, tenant_id, connection_id, channel_id, thread_ref,
          ticket_id, ticket_version)
       values ('slkthread_ci', 'inst_ci', $1, 'slkconn_ci', 'slkchan_ci',
               'threadref_ci', $2, 1)`,
      [TENANT, IDS.ticket],
    );
    await app.query(
      `insert into support.slack_identity_mappings
         (id, installation_id, tenant_id, connection_id, provider_user_ref, actor_id)
       values ('slkident_ci', 'inst_ci', $1, 'slkconn_ci', 'provuser_ci', 'user_ci')`,
      [TENANT],
    );
    await app.query(
      `insert into support.slack_action_receipts
         (action_id, installation_id, tenant_id, connection_id, channel_id,
          thread_id, identity_mapping_id, ticket_id, expected_ticket_version, action,
          actor_id)
       values ('slkaction_ci', 'inst_ci', $1, 'slkconn_ci', 'slkchan_ci',
               'slkthread_ci', 'slkident_ci', $2, 1, 'acknowledge', 'user_ci')`,
      [TENANT, IDS.ticket],
    );
    const aiRequest = "a1000000-0000-4000-8000-000000000001";
    const aiSuggestion = "a1000000-0000-4000-8000-000000000002";
    const aiPreparation = "a1000000-0000-4000-8000-000000000003";
    await app.query(`insert into support.ai_suggestion_requests(id,tenant_id,ticket_id,ticket_version,actor_id,idempotency_key,input_digest,input_watermark,sources,control_epoch,admitted,retention_until)
      values($1,$2,$3,1,'user_ci','ci-ai',$4,'ci-watermark','[]',1,true,clock_timestamp()+interval '1 day')`,[aiRequest,TENANT,IDS.ticket,"a".repeat(64)]);
    await app.query(`insert into support.ai_suggestion_policy_snapshots(tenant_id,request_id,preparation_id,policy) values($1,$2,$3,$4::jsonb)`,[TENANT,aiRequest,aiPreparation,JSON.stringify({preparationId:aiPreparation,provider:"synthetic",model:"support-fixture-v1",region:"us",retentionPosture:"zero_retention",allowlistVersion:"synthetic-support-v1",source:"platform_default",processingBasis:"tenant_region",consentId:null,consentPolicyVersion:null})]);
    await app.query(`insert into support.ai_suggestion_attempts(tenant_id,request_id,preparation_id,execution_id,attempt) values($1,$2,$3,'a1000000-0000-4000-8000-000000000004',$4::jsonb)`,[TENANT,aiRequest,aiPreparation,JSON.stringify({preparationId:aiPreparation,executionId:"a1000000-0000-4000-8000-000000000004",tenantId:TENANT,moduleId:"support",useCase:"reviewed-suggestion",provider:"synthetic",model:"support-fixture-v1",region:"us",retentionPosture:"zero_retention",allowlistVersion:"synthetic-support-v1",credentialOrigin:"installation",terminal:"started",evidenceOrigin:"synthetic"})]);
    const aiArtifact=JSON.stringify({category:"how_to",priority:"medium",reply:"Synthetic article body",claims:[{text:"Synthetic article body",citation:{chunkId:"ci-chunk",start:0,end:22}}],sources:[],schemaVersion:1});
    await app.query(`insert into support.ai_suggestions(id,tenant_id,request_id,artifact,artifact_digest) values($1,$2,$3,$4::jsonb,encode(sha256(convert_to($4::jsonb::text,'UTF8')),'hex'))`,[aiSuggestion,TENANT,aiRequest,aiArtifact]);
    await app.query(`insert into support.ai_suggestion_terminals(tenant_id,request_id,kind,suggestion_id,artifact_digest) select $1,$2,'review_required',id,artifact_digest from support.ai_suggestions where tenant_id=$1 and id=$3`,[TENANT,aiRequest,aiSuggestion]);
    await app.query(`insert into support.ai_suggestion_reviews(tenant_id,request_id,suggestion_id,actor_id,decision,ticket_version) values($1,$2,$3,'user_ci','reviewed',1)`,[TENANT,aiRequest,aiSuggestion]);
    for(const action of ["requested","policy_resolved","provider_started","suggestion_created","reviewed","terminal"]) await app.query(`insert into support.ai_suggestion_audit_events(tenant_id,request_id,actor_id,action) values($1,$2,'user_ci',$3)`,[TENANT,aiRequest,action]);
    await app.query("commit");
  } catch (error) {
    await app.query("rollback");
    throw error;
  }
}

async function verifyTableInventory(owner) {
  const expected = TABLES.map(qualifiedName).sort();
  const result = await owner.query(
    `select n.nspname || '.' || c.relname as qualified_name
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1::text[])
        and c.relkind in ('r', 'p')
      order by qualified_name`,
    [["tenant_core", "brain", "support"]],
  );
  const actual = result.rows.map((row) => row.qualified_name);
  const missing = expected.filter((name) => !actual.includes(name));
  const unexpected = actual.filter((name) => !expected.includes(name));
  check(
    "tenant table inventory is exact",
    missing.length === 0 && unexpected.length === 0,
    `missing=[${missing.join(", ")}], unexpected=[${unexpected.join(", ")}]`,
  );
}

async function verifyPolicyShape(owner) {
  const relations = await owner.query(
    `select n.nspname as schema_name,
            c.relname as table_name,
            c.relrowsecurity as rls_enabled,
            c.relforcerowsecurity as rls_forced
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1::text[])
        and c.relkind in ('r', 'p')`,
    [["tenant_core", "brain", "support"]],
  );
  const policies = await owner.query(
    `select schemaname as schema_name,
            tablename as table_name,
            policyname as policy_name,
            roles::text as policy_roles,
            cmd as policy_command,
            qual as using_expression,
            with_check as check_expression
       from pg_catalog.pg_policies
      where schemaname = any($1::text[])
      order by schemaname, tablename, policyname`,
    [["tenant_core", "brain", "support"]],
  );
  const relationByName = new Map(relations.rows.map((row) => [`${row.schema_name}.${row.table_name}`, row]));
  const policiesByName = new Map();
  for (const policy of policies.rows) {
    const name = `${policy.schema_name}.${policy.table_name}`;
    policiesByName.set(name, [...(policiesByName.get(name) ?? []), policy]);
  }
  for (const table of TABLES) {
    const name = qualifiedName(table);
    const relation = relationByName.get(name);
    const tablePolicies = policiesByName.get(name) ?? [];
    const policy = tablePolicies[0];
    check(`${name} has ENABLE RLS`, relation?.rls_enabled === true);
    check(`${name} has FORCE RLS`, relation?.rls_forced === true);
    check(`${name} has exactly one tenant policy`, tablePolicies.length === 1, `received ${tablePolicies.length}`);
    check(
      `${name} policy applies to ALL commands for public`,
      policy?.policy_command === "ALL" && policy?.policy_roles === "{public}",
      `command=${policy?.policy_command ?? "none"}, roles=${policy?.policy_roles ?? "none"}`,
    );
    check(
      `${name} policy USING is the exact tenant binding`,
      policy?.using_expression === TENANT_POLICY_EXPRESSION,
      `received ${policy?.using_expression ?? "none"}`,
    );
    check(
      `${name} policy WITH CHECK is the exact tenant binding`,
      policy?.check_expression === TENANT_POLICY_EXPRESSION,
      `received ${policy?.check_expression ?? "none"}`,
    );
  }
}

async function verifyVisibility(app, label, tenantId, expectedRows) {
  await app.query("begin");
  try {
    if (tenantId !== null) {
      await setTenant(app, tenantId);
    }
    for (const table of TABLES) {
      const name = qualifiedName(table);
      const result = await app.query(`select count(*)::int as n from ${name} where tenant_id = $1`, [TENANT]);
      const expected = expectedRows ? table.expectedRows : 0;
      check(`${label}: ${name} TENANT rows = ${expected}`, result.rows[0].n === expected, `received ${result.rows[0].n}`);
    }
    await app.query("commit");
  } catch (error) {
    await app.query("rollback");
    throw error;
  }
}

async function verifyRejectedInsert(app, label, tenantId, sourceId) {
  await app.query("begin");
  try {
    if (tenantId !== null) {
      await setTenant(app, tenantId);
    }
    await expectSqlState(
      app,
      `${label}: cross-context insert rejected with insufficient_privilege`,
      `insert into brain.raw_signals (tenant_id, source, source_id, visibility, content_hash)
       values ($1, 'ci', $2, 'internal', 'rejected-hash')`,
      [TENANT, sourceId],
    );
  } finally {
    await app.query("rollback");
  }
}

async function verifyDeniedMutation(app, name, sql) {
  await app.query("begin");
  try {
    await setTenant(app, TENANT);
    await expectSqlState(app, name, sql);
  } finally {
    await app.query("rollback");
  }
}

async function verifyImmutability(app) {
  const denied = [
    ["raw_signals update rejected with insufficient_privilege", "update brain.raw_signals set source = 'changed' where tenant_id = 'ten_ci'"],
    ["raw_signals delete rejected with insufficient_privilege", "delete from brain.raw_signals where tenant_id = 'ten_ci'"],
    ["decisions_log update rejected with insufficient_privilege", "update brain.decisions_log set decision = 'changed' where tenant_id = 'ten_ci'"],
    ["decisions_log delete rejected with insufficient_privilege", "delete from brain.decisions_log where tenant_id = 'ten_ci'"],
    ["raw_signal_payloads update rejected with insufficient_privilege", "update brain.raw_signal_payloads set payload_text = 'changed' where tenant_id = 'ten_ci'"],
    ["slack_action_receipts update rejected with insufficient_privilege", "update support.slack_action_receipts set action = 'resolve' where tenant_id = 'ten_ci'"],
    ["slack_action_receipts delete rejected with insufficient_privilege", "delete from support.slack_action_receipts where tenant_id = 'ten_ci'"],
    ["ticket_events update rejected with insufficient_privilege", "update support.ticket_events set kind = 'reply' where tenant_id = 'ten_ci'"],
    ["ticket_events delete rejected with insufficient_privilege", "delete from support.ticket_events where tenant_id = 'ten_ci'"],
    ["messages update rejected with insufficient_privilege", "update support.messages set body = 'changed' where tenant_id = 'ten_ci'"],
    ["messages delete rejected with insufficient_privilege", "delete from support.messages where tenant_id = 'ten_ci'"],
    ["tickets delete rejected with insufficient_privilege", "delete from support.tickets where tenant_id = 'ten_ci'"],
    ["outbox_events delete rejected with insufficient_privilege", "delete from support.outbox_events where tenant_id = 'ten_ci'"],
    ["delivery_attempts update rejected with insufficient_privilege", "update support.delivery_attempts set status = 'failed' where tenant_id = 'ten_ci'"],
    ["delivery_attempts delete rejected with insufficient_privilege", "delete from support.delivery_attempts where tenant_id = 'ten_ci'"],
    ["attachments update rejected with insufficient_privilege", "update support.attachments set file_name = 'changed.txt' where tenant_id = 'ten_ci'"],
    ["attachments delete rejected with insufficient_privilege", "delete from support.attachments where tenant_id = 'ten_ci'"],
    ["csat_responses update rejected with insufficient_privilege", "update support.csat_responses set rating = 1 where tenant_id = 'ten_ci'"],
    ["csat_responses delete rejected with insufficient_privilege", "delete from support.csat_responses where tenant_id = 'ten_ci'"],
    ["depth_events update rejected with insufficient_privilege", "update support.depth_events set subject_ref = 'changed' where tenant_id = 'ten_ci'"],
    ["depth_events delete rejected with insufficient_privilege", "delete from support.depth_events where tenant_id = 'ten_ci'"],
  ];
  for (const [name, sql] of denied) {
    await verifyDeniedMutation(app, name, sql);
  }

  // The outbox allows delivery-state updates but its trigger rejects any
  // rewrite of identity or payload, and the payload CHECK denies content keys.
  await app.query("begin");
  try {
    await setTenant(app, TENANT);
    await expectSqlState(
      app,
      "outbox_events payload rewrite rejected by append-only trigger",
      "update support.outbox_events set payload = '{}'::jsonb where tenant_id = 'ten_ci'",
      [],
      "P0001",
    );
  } finally {
    await app.query("rollback");
  }
  await app.query("begin");
  try {
    await setTenant(app, TENANT);
    await expectSqlState(
      app,
      "depth_events content-bearing evidence rejected by check constraint",
      `insert into support.depth_events
         (tenant_id, actor_id, action, subject_ref, detail)
       values
         ('ten_ci', 'user_ci', 'support.csat.submitted', 'SUP-000001',
          '{"comment":"leaked"}'::jsonb)`,
      [],
      "23514",
    );
  } finally {
    await app.query("rollback");
  }
  await app.query("begin");
  try {
    await setTenant(app, TENANT);
    await expectSqlState(
      app,
      "outbox_events content-bearing envelope rejected by check constraint",
      `insert into support.outbox_events
         (tenant_id, ticket_id, ticket_number, ticket_version, kind, payload)
       values ('ten_ci', '${IDS.ticket}', 'SUP-000001', 2, 'reply',
               '{"schemaVersion":1,"subject":"leaked"}'::jsonb)`,
      [],
      "23514",
    );
  } finally {
    await app.query("rollback");
  }

  await app.query("begin");
  try {
    await setTenant(app, TENANT);
    const deleted = await app.query(
      "delete from brain.raw_signal_payloads where tenant_id = $1 returning raw_signal_id",
      [TENANT],
    );
    check("raw_signal_payloads delete is explicitly allowed", deleted.rowCount === 1, `deleted ${deleted.rowCount ?? 0} rows`);
  } finally {
    await app.query("rollback");
  }

  await app.query("begin");
  try {
    await setTenant(app, TENANT);
    const restored = await app.query(
      "select count(*)::int as n from brain.raw_signal_payloads where tenant_id = $1",
      [TENANT],
    );
    check("raw_signal_payloads allowed delete proof rolls back", restored.rows[0].n === 1);
    await app.query("commit");
  } catch (error) {
    await app.query("rollback");
    throw error;
  }
}

async function preflightFreshEnvironment(owner) {
  const schemas = await owner.query(
    `select nspname
       from pg_catalog.pg_namespace
      where nspname = any($1::text[])
      order by nspname`,
    [["tenant_core", "brain", "support"]],
  );
  if (schemas.rowCount !== 0) {
    throw new Error(
      `RLS proof requires a fresh ephemeral database; found application schemas: ${schemas.rows.map((row) => row.nspname).join(", ")}`,
    );
  }
  check("fresh database has no pre-existing application schemas", true);

  const roles = await owner.query("select rolname from pg_catalog.pg_roles where rolname = $1", [APP_ROLE]);
  if (roles.rowCount !== 0) {
    throw new Error(`RLS proof requires a fresh ephemeral cluster; role ${APP_ROLE} already exists`);
  }
  check(`fresh cluster has no pre-existing ${APP_ROLE} role`, true);
}

async function removeAppRole(owner) {
  await owner.query(`drop owned by ${APP_ROLE}`);
  await owner.query(`drop role ${APP_ROLE}`);
  const remaining = await owner.query("select count(*)::int as n from pg_catalog.pg_roles where rolname = $1", [APP_ROLE]);
  check(`${APP_ROLE} role removed after proof`, remaining.rows[0].n === 0, `received ${remaining.rows[0].n} roles`);
}

async function main() {
  const owner = new pg.Client({ connectionString: ownerUrl });
  let app;
  let ownerConnected = false;
  let roleCreated = false;
  let proofError;
  let cleanupError;
  try {
    await owner.connect();
    ownerConnected = true;
    await preflightFreshEnvironment(owner);
    // All DDL, migrations, grants and login credentials come from provisioning.
    await prepareTenantDatabase(ownerUrl, TENANT, "us");
    roleCreated = true;
    const { appConnectionUri } = await createAppRole(ownerUrl);
    app = new pg.Client({ connectionString: appConnectionUri });
    await app.connect();
    await prepareTenantDatabase(ownerUrl, TENANT, "us");
    const metadata = await owner.query("select tenant_id, data_region from tenant_core.tenant_meta");
    check("canonical provisioning seeds one tenant anchor", metadata.rowCount === 1 && metadata.rows[0].tenant_id === TENANT);
    check("canonical provisioning replay preserves region", metadata.rows[0].data_region === "us");
    const role = await owner.query("select rolbypassrls, rolsuper from pg_roles where rolname = $1", [APP_ROLE]);
    check("canonical app role cannot bypass RLS", role.rows[0].rolbypassrls === false);
    check("canonical app role is not superuser", role.rows[0].rolsuper === false);

    console.log("\n1. schema and policy inventory");
    await verifyTableInventory(owner);
    await verifyPolicyShape(owner);

    console.log("\n2. dependency-correct synthetic seed as NOBYPASSRLS app role");
    await owner.query("insert into support.ai_controls(tenant_id) values ($1)", [TENANT]);
    await seedSyntheticData(app);
    check("synthetic tenant seed completed", true);

    console.log("\n3. per-table fail-closed visibility matrix");
    await verifyVisibility(app, "no context", null, false);
    await verifyVisibility(app, "wrong context", OTHER_TENANT, false);
    await verifyVisibility(app, "correct context", TENANT, true);

    console.log("\n4. write policy SQLSTATE proof");
    await verifyRejectedInsert(app, "no context", null, "rejected-no-context");
    await verifyRejectedInsert(app, "wrong context", OTHER_TENANT, "rejected-wrong-context");

    console.log("\n5. immutable and redaction mutation matrix");
    await verifyImmutability(app);
  } catch (error) {
    proofError = error;
  } finally {
    if (app) {
      try {
        await app.end();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (ownerConnected && roleCreated) {
      try {
        await removeAppRole(owner);
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (ownerConnected) {
      try {
        await owner.end();
      } catch (error) {
        cleanupError ??= error;
      }
    }
  }

  if (!proofError && failures > 0) {
    proofError = new Error(`${failures} of ${checks} RLS proof checks failed`);
  }
  if (proofError) {
    if (cleanupError) {
      console.error(
        `RLS proof cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : "unknown cleanup error"}`,
      );
    }
    throw proofError;
  }
  if (cleanupError) {
    throw cleanupError;
  }
  console.log(`\nAll ${checks} RLS proof checks passed across ${TABLES.length} tenant tables`);
}

main().catch((error) => {
  console.error(`\nRLS proof failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
