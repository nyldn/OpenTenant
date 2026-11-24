import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PullPolicy, Wait } from 'testcontainers';
import { startLoopbackRelay } from './relay.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

class LoopbackPostgresContainer extends PostgreSqlContainer {
  /** @param {string | undefined} socketDirectory */
  constructor(socketDirectory) {
    super(POSTGRES_IMAGE);
    // Use Docker's exec transport rather than publishing a container network.
    this.exposedPorts.length = 0;
    this.createOpts.ExposedPorts = {};
    this.hostConfig.PortBindings = {};
    this.withNetworkMode('none').withWaitStrategy(Wait.forHealthCheck());
    this.withHealthCheck({ test: ['CMD', 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres'],
      interval: 2_000, timeout: 3_000, retries: 60, startPeriod: 30_000 });
    this.withCommand(['postgres', '-c', 'listen_addresses=127.0.0.1', ...(socketDirectory ? ['-c', 'unix_socket_directories=/var/run/postgresql,/proof-socket'] : [])]);
    this.withEnvironment({ POSTGRES_INITDB_ARGS: '--auth-local=scram-sha-256' });
    if (socketDirectory) this.withBindMounts([{ source: socketDirectory, target: '/proof-socket' }]);
  }
}
import pg from 'pg';

export const POSTGRES_IMAGE = 'pgvector/pgvector:0.8.2-pg17-bookworm';

/** @param {number} port */
export function validateHostPort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 5432) {
    throw new Error('Ephemeral PostgreSQL requires a random host port other than 5432');
  }
  return port;
}

/** @param {string} url @param {string} sql */
export async function queryPostgres(url, sql) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000, query_timeout: 60_000 });
  try { await client.connect(); return await client.query(sql); }
  finally { await client.end(); }
}

/**
 * Empty synthetic cluster. No migrations or extensions are applied.
 * The injectable boundaries let unit tests cover failed startup and cleanup.
 * @param {{start?: (password: string) => Promise<any>, query?: (url: string, sql: string) => Promise<{rows: any[]}>, labels?: Record<string, string>}} [dependencies]
 */
export async function startEphemeralPostgres({ start, query = queryPostgres, labels = {} } = {}) {
  const password = randomBytes(32).toString('hex');
  const appPassword = randomBytes(32).toString('hex');
  /** @type {Awaited<ReturnType<typeof startLoopbackRelay>> | undefined} */
  let relay;
  /** @type {import("testcontainers").StartedTestContainer | undefined} */
  let container;
  let disposed = false;
  let phase = "Docker startup";
  let containerName;
  /** @type {string | undefined} */
  let socketRoot;
  /** @type {import("node:child_process").ChildProcess | undefined} */
  let guardian;
  async function dispose() {
    if (disposed) return;
    // Do not mark disposed if removal fails: callers can retry, and the guardian
    // removes resources when this process or worker exits unexpectedly.
    try {
      if (relay) await relay.dispose();
      if (container) await container.stop({ timeout: 10_000, removeVolumes: true });
      if (socketRoot) rmSync(socketRoot, { recursive: true, force: true });
    } finally { guardian?.stdin?.end(); }
    disposed = true;
  }
  try {
    if (start) container = await start(password);
    else {
      const name = `opentenant-proof-${randomUUID()}`;
      containerName = name;
      let socketDirectory;
      if (process.platform === 'linux') {
        socketRoot = join(tmpdir(), name);
        mkdirSync(socketRoot, { mode: 0o700 });
        socketDirectory = join(socketRoot, 'socket');
        mkdirSync(socketDirectory, { mode: 0o777 });
        // umask must not prevent the isolated container's postgres UID writing.
        chmodSync(socketDirectory, 0o777);
      }
      // An independent process observes EOF even if this controller is killed.
      // Only random resource names cross this pipe, never database credentials.
      guardian = spawn(process.execPath, [new URL('./cleanup.mjs', import.meta.url).pathname, name, socketRoot ?? ''], {
        stdio: ['pipe', 'ignore', 'ignore'], detached: true,
        env: { PATH: process.env.PATH, DOCKER_HOST: process.env.DOCKER_HOST, DOCKER_CONTEXT: process.env.DOCKER_CONTEXT, HOME: process.env.HOME },
      });
      await new Promise((resolve, reject) => { guardian?.once('spawn', resolve); guardian?.once('error', reject); });
      guardian.unref();
      if (guardian.stdin) /** @type {import("node:net").Socket} */ (guardian.stdin).unref();
      container = await new LoopbackPostgresContainer(socketDirectory)
        .withName(name).withLabels(labels).withAutoCleanup(false).withPullPolicy(PullPolicy.neverPull())
        .withDatabase('postgres').withUsername('postgres').withPassword(password)
        .withEnvironment({ PGPASSWORD: password })
        .withStartupTimeout(120_000).start();
      relay = await startLoopbackRelay(name, socketDirectory ? join(socketDirectory, ".s.PGSQL.5432") : undefined);
    }
    if (!container) throw new Error("Docker did not return a PostgreSQL container");
    phase = "host port validation, excluding 5432";
    const port = validateHostPort(relay?.port ?? container.getMappedPort(5432));
    const adminUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
    phase = "pgvector availability check";
    const extension = await query(adminUrl, "select name from pg_available_extensions where name = 'vector'");
    if (extension.rows.length !== 1) throw new Error('pgvector extension is missing');
    phase = "empty application database setup";
    await query(adminUrl, `create role opentenant_app login password '${appPassword}' nosuperuser nocreatedb nocreaterole noreplication nobypassrls`);
    await query(adminUrl, 'create database opentenant_ephemeral owner opentenant_app');
    const appUrl = `postgresql://opentenant_app:${appPassword}@127.0.0.1:${port}/opentenant_ephemeral`;
    return { adminUrl, appUrl, port, containerName, dispose };
  } catch {
    await dispose();
    // Docker errors can contain connection metadata. Keep them out of logs.
    throw new Error(`Ephemeral PostgreSQL failed during ${phase}: Docker must be available with ${POSTGRES_IMAGE} and pgvector installed; the image must be loaded locally`);
  }
}
