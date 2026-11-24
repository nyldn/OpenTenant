// The worker keeps async Docker and socket IO alive while the controller's
// existing synchronous verification API runs bounded child commands.
import { workerData } from 'node:worker_threads';
import { mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import { startEphemeralPostgres, queryPostgres } from '../../db-ephemeral/postgres.mjs';

const { port, ready } = workerData;
/** @type {Awaited<ReturnType<typeof startEphemeralPostgres>> | undefined} */
let database;
/** @type {import("node:net").Server | undefined} */
let server;
/** @type {string | undefined} */
let directory;
/** @type {Set<import("node:net").Socket>} */
const sockets = new Set();
async function dispose() {
  for (const socket of sockets) socket.destroy();
  if (server) await new Promise(resolve => server?.close(() => resolve(undefined)));
  server = undefined;
  await database?.dispose();
  if (directory) { chmodSync(directory, 0o700); rmSync(directory, { recursive: true, force: true }); }
}
/** @param {string} name @param {string} sql */
async function query(name, sql) {
  if (!database) throw new Error('database is not running');
  const url = new URL(database.adminUrl); url.pathname = `/${name}`;
  return (await queryPostgres(url.toString(), sql)).rows;
}
/** @param {{operation: string, payload: any}} message */
async function handleMessage({ operation, payload }) {
  try {
    let value;
    if (operation === 'start') {
      database = await startEphemeralPostgres();
      const password = randomBytes(32).toString('hex');
      await query('postgres', `revoke connect on database postgres from public; revoke connect on database template1 from public;
        create role opentenant_proof login password '${password}' nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 12;
        alter role opentenant_proof set statement_timeout = '5min';
        alter role opentenant_proof set idle_in_transaction_session_timeout = '30s';
        alter role opentenant_proof set temp_file_limit = '256MB';
        alter role opentenant_proof set lock_timeout = '60s'`);
      for (const name of payload.databases) {
        if (!/^opentenant_it_proof_[a-z_]+$/.test(name)) throw new Error('unsafe proof database');
        await query('postgres', `create database ${name} owner opentenant_proof template template0`);
        await query('postgres', `revoke connect on database ${name} from public; grant connect on database ${name} to opentenant_proof`);
      }
      directory = mkdtempSync(join(tmpdir(), 'otp-')); chmodSync(directory, 0o700);
      const socketPath = join(directory, '.s.PGSQL.55439');
      const upstreamPort = database.port;
      server = createServer(socket => {
        const upstream = createConnection({ host: '127.0.0.1', port: upstreamPort });
        sockets.add(socket); sockets.add(upstream);
        socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
        socket.on('close', () => { sockets.delete(socket); upstream.destroy(); });
        upstream.on('close', () => { sockets.delete(upstream); socket.destroy(); });
        socket.pipe(upstream); upstream.pipe(socket);
      });
      await new Promise((resolve, reject) => { server?.once('error', reject); server?.listen(socketPath, () => resolve(undefined)); });
      chmodSync(directory, 0o500);
      const [identity] = await query('postgres', 'select system_identifier::text, pg_postmaster_start_time()::text as started, clock_timestamp()::text as proof_started from pg_control_system()');
      value = { socketDirectory: directory, socketPath, port: 55439, password, identity };
    } else if (operation === 'query') {
      value = await query(payload.database, payload.sql);
    } else if (operation === 'seal') {
      for (const socket of sockets) socket.destroy();
      if (server) await new Promise(resolve => server?.close(() => resolve(undefined)));
      server = undefined;
      await query('postgres', "alter role opentenant_proof nologin; select pg_terminate_backend(pid) from pg_stat_activity where usename = 'opentenant_proof'");
      const [active] = await query('postgres', "select count(*)::int as count from pg_stat_activity where usename = 'opentenant_proof'");
      if (active.count !== 0) throw new Error('restricted sessions survived sealing');
      value = true;
    } else if (operation === 'dispose') {
      await dispose(); value = true;
    } else throw new Error('unknown database worker operation');
    port.postMessage({ value });
  } catch {
    // Never serialize pg/Docker errors containing credentials to the controller.
    if (operation === 'start') await dispose();
    port.postMessage({ error: `Ephemeral PostgreSQL ${operation} failed; check Docker and pgvector` });
  } finally { Atomics.store(ready, 0, 1); Atomics.notify(ready, 0); }
}
port.on("message", handleMessage);
