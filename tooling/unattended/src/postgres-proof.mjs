// @ts-check
import { Worker, MessageChannel, receiveMessageOnPort } from "node:worker_threads";
const ROLE_CONNECTION_LIMIT = 12;

/** @type {Record<string, Array<{database: string, proofSql: string}>>} */
const PROFILES = {
  smoke: [
    {
      database: "opentenant_it_proof_smoke",
      proofSql: `
        to_regclass('public.schema_migrations') is not null
        and to_regclass('public.module_version_capabilities') is not null
        and to_regclass('public.tenant_module_capability_grants') is not null
        and exists (
          select 1 from schema_migrations
           where id = '0015_module_capabilities'
             and applied_at >= '__PROOF_STARTED_AT__'::timestamptz
             and applied_at <= clock_timestamp()
        )
        and exists (
          select 1 from module_versions
           where module_key = 'tenant-portal' and version = '1.0.0'
        )
        and exists (
          select 1 from pg_trigger
           where tgname = 'module_version_capabilities_enforce_immutability'
             and pg_get_triggerdef(oid) like '%BEFORE INSERT OR DELETE OR UPDATE%'
        )
        and exists (
          select 1 from pg_proc
           where proname = 'enforce_module_capability_declaration_immutability'
             and pg_get_functiondef(oid) like '%pg_advisory_xact_lock%'
        )
        and exists (
          select 1 from pg_constraint
           where conname = 'tenant_module_capability_grants_expiry_order'
             and pg_get_constraintdef(oid) like 'CHECK%expires_at%granted_at%'
        )`,
    },
  ],
  admission: [
    {
      database: "opentenant_it_proof_admission_migration",
      proofSql: `
        to_regclass('public.admission_policies') is not null
        and to_regclass('public.admission_windows') is not null
        and to_regclass('public.admission_leases') is not null
        and to_regclass('public.admission_idempotency_records') is not null
        and exists (
          select 1 from schema_migrations
           where id = '0026_admission'
             and applied_at >= '__PROOF_STARTED_AT__'::timestamptz
             and applied_at <= clock_timestamp()
        )
        and exists (select 1 from admission_policies)
        and exists (select 1 from admission_windows)
        and exists (
          select 1 from pg_constraint
           where conrelid = 'admission_windows'::regclass
             and contype in ('c', 'u', 'p')
        )`,
    },
    {
      database: "opentenant_it_proof_admission_store",
      proofSql: `
        to_regclass('public.admission_policies') is not null
        and to_regclass('public.admission_leases') is not null
        and to_regclass('public.admission_idempotency_records') is not null
        and exists (select 1 from admission_leases)
        and exists (select 1 from admission_idempotency_records)
        and not exists (
          select tenant_id, scope_key, window_started_at
            from admission_windows
           group by tenant_id, scope_key, window_started_at
          having sum(admitted_count) > max(limit_count)
        )`,
    },
  ],
  usage: [
    {
      database: "opentenant_it_proof_usage_migration",
      proofSql: `
        to_regclass('public.usage_metric_definitions') is not null
        and to_regclass('public.exact_usage_events') is not null
        and exists (
          select 1 from schema_migrations
           where id = '0027_usage_ledger'
             and applied_at >= '__PROOF_STARTED_AT__'::timestamptz
             and applied_at <= clock_timestamp()
        )
        and exists (select 1 from usage_metric_definitions)
        and exists (select 1 from exact_usage_events)
        and exists (
          select 1 from pg_trigger
           where tgrelid = 'exact_usage_events'::regclass
             and pg_get_triggerdef(oid) like '%BEFORE%'
             and pg_get_triggerdef(oid) like '%UPDATE%'
             and pg_get_triggerdef(oid) like '%DELETE%'
             and pg_get_triggerdef(oid) like '%TRUNCATE%'
        )`,
    },
    {
      database: "opentenant_it_proof_usage_store",
      proofSql: `
        to_regclass('public.usage_metric_definitions') is not null
        and to_regclass('public.exact_usage_events') is not null
        and exists (select 1 from usage_metric_definitions)
        and exists (select 1 from exact_usage_events)
        and exists (
          select 1 from exact_usage_events where correction_of_event_id is not null
        )
        and not exists (
          select tenant_id, idempotency_key
            from exact_usage_events
           where idempotency_key is not null
           group by tenant_id, idempotency_key
          having count(*) > 1
        )`,
    },
  ],
};

/** @param {string} profile */
function profileEntries(profile) {
  const entries = PROFILES[profile];
  if (!entries) throw new Error(`unknown PostgreSQL proof profile ${profile}`);
  return entries;
}

/**
 * @param {NodeJS.ProcessEnv} source
 * @param {{profile: string, socketDirectory: string, port: number, restrictedRole: string, password: string}} cluster
 */
export function buildPostgresProofEnvironment(source, cluster) {
  /** @type {NodeJS.ProcessEnv} */
  const environment = {
    HOME: source.HOME,
    PATH: source.PATH,
    TMPDIR: source.TMPDIR,
    TERM: source.TERM,
    OPENTENANT_POSTGRES_PROOF_PROFILE: cluster.profile,
    OPENTENANT_POSTGRES_PROOF_SOCKET_DIRECTORY: cluster.socketDirectory,
    OPENTENANT_POSTGRES_PROOF_PORT: String(cluster.port),
    OPENTENANT_POSTGRES_PROOF_ROLE: cluster.restrictedRole,
    PGPASSWORD: cluster.password,
  };
  if (source.CI !== undefined) environment.CI = source.CI;
  return Object.fromEntries(Object.entries(environment).filter(([, value]) => value !== undefined));
}

/**
 * @param {{
 *  rolcanlogin: boolean, rolsuper: boolean, rolcreatedb: boolean,
 *  rolcreaterole: boolean, rolreplication: boolean, rolbypassrls: boolean,
 *  rolconnlimit: number,
 * }} attributes
 */
export function validateRestrictedRoleAttributes(attributes) {
  if (
    attributes.rolcanlogin !== true
    || attributes.rolsuper !== false
    || attributes.rolcreatedb !== false
    || attributes.rolcreaterole !== false
    || attributes.rolreplication !== false
    || attributes.rolbypassrls !== false
    || attributes.rolconnlimit !== ROLE_CONNECTION_LIMIT
  ) throw new Error("PostgreSQL proof restricted role attributes are unsafe");
}


/** @param {string} root @param {string} profile */
export function preparePostgresProofCluster(root, profile) {
  const entries = profileEntries(profile);
  const { port1, port2 } = new MessageChannel();
  const ready = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(new URL('./postgres-worker.mjs', import.meta.url), {
    workerData: { port: port2, ready }, transferList: [port2],
  });
  // An uncaught worker error must not crash the controller before finally.
  worker.on('error', () => {});
  /** @param {string} operation @param {any} [payload] */
  function request(operation, payload) {
    Atomics.store(ready, 0, 0); port1.postMessage({ operation, payload });
    if (Atomics.wait(ready, 0, 0, 180_000) === 'timed-out') {
      void worker.terminate(); throw new Error('Ephemeral PostgreSQL worker timed out; verification refused');
    }
    const response = receiveMessageOnPort(port1)?.message;
    if (!response || response.error) throw new Error(response?.error ?? 'PostgreSQL worker failed closed');
    return response.value;
  }
  try {
    const metadata = request('start', { databases: entries.map(entry => entry.database) });
    const cluster = { ...metadata, profile, root, restrictedRole: 'opentenant_proof', request, worker, port: metadata.port, channel: port1 };
    const [attributes] = request('query', { database: 'postgres', sql: "select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolconnlimit from pg_roles where rolname = 'opentenant_proof'" });
    validateRestrictedRoleAttributes(attributes);
    return cluster;
  } catch (error) {
    try { request('dispose'); } finally { port1.close(); void worker.terminate(); }
    throw error;
  }
}

/** @param {any} cluster */
export function completePostgresProofCluster(cluster) {
  cluster.request('seal');
  for (const entry of profileEntries(cluster.profile)) {
    const sql = entry.proofSql.replaceAll('__PROOF_STARTED_AT__', cluster.identity.proof_started.replaceAll("'", "''"));
    const [result] = cluster.request('query', { database: entry.database, sql: `select system_identifier::text, pg_postmaster_start_time()::text as started, (${sql}) as proof from pg_control_system()` });
    if (result.system_identifier !== cluster.identity.system_identifier || result.started !== cluster.identity.started || result.proof !== true) {
      throw new Error(`controller PostgreSQL proof assertion or cluster identity failed for ${entry.database}`);
    }
  }
}

/** @param {any} cluster @param {boolean} [_retain] */
export function cleanupPostgresProofCluster(cluster, _retain = false) {
  try { cluster.request('dispose'); }
  finally { cluster.channel.close(); void cluster.worker.terminate(); }
  return { retained: false, path: cluster.socketDirectory };
}
