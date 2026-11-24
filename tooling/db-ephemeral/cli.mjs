import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startEphemeralPostgres } from './postgres.mjs';
import { proofEnvironment } from './environment.mjs';
import { createIntegrationDatabases } from '../ci/create-integration-databases.mjs';

const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
if (!args.length) throw new Error('usage: pnpm db:ephemeral -- <command> [args...]');
let database;
let child;
let signalCode;
/** @param {NodeJS.Signals} signal */
function signalChild(signal) {
  signalCode = signal === 'SIGINT' ? 130 : 143;
  if (child?.pid) { try { process.kill(-child.pid, signal);
    const pid = child.pid;
    setTimeout(() => { try { process.kill(-pid, "SIGKILL"); } catch { /* exited */ } }, 250).unref(); } catch { /* already exited */ } }
}
const onInt = () => signalChild('SIGINT');
const onTerm = () => signalChild('SIGTERM');
process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
try {
  database = await startEphemeralPostgres();
  await createIntegrationDatabases(database.adminUrl, { log: () => {}, allowUnixSocketServer: process.platform === "linux" });
  if (signalCode) process.exitCode = signalCode;
  else {
    const [command, ...commandArgs] = args;
    child = spawn(command, commandArgs, {
      env: proofEnvironment(database.adminUrl, { ...process.env, DATABASE_STORE_REPORT_DIRECTORY: process.env.DATABASE_STORE_REPORT_DIRECTORY ?? join(tmpdir(), "opentenant-store-reports", database.containerName ?? String(process.pid)) }),
      stdio: 'inherit', shell: false, detached: true,
    });
    const killGroup = () => { if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* exited */ } } };
    const timer = setTimeout(() => { signalCode = 124; killGroup(); }, 30 * 60 * 1000);
    try {
      process.exitCode = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', code => resolve(signalCode ?? code ?? 1));
      });
    } finally { clearTimeout(timer); killGroup(); }
  }
} catch (error) {
  if (!database && error instanceof Error) console.error(error.message);
  console.error('Ephemeral database command failed. Check Docker, the pgvector image and command availability. No proof was skipped.');
  process.exitCode = 1;
} finally {
  await database?.dispose();
  process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
}
