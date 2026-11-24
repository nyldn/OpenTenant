import pg from 'pg';
import { runLocalSetup } from '../../migrations/src/local.mjs';

// Synthetic operator UI fixture. Never seeds a hosted installation or invokes adapters.
const databaseUrl = process.env.CONTROL_PLANE_DATABASE_URL;
if (!databaseUrl || !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)) throw new Error('Explicit loopback CONTROL_PLANE_DATABASE_URL required');
await runLocalSetup({ databaseUrl });
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  await pool.query(`insert into tenant_worker_jobs(id,tenant_id,kind,status,attempts,actor,last_error)
    values ('00000000-0000-4000-8000-000000000001','tenant_local','export','failed',5,'{"kind":"system","job":"synthetic-e2e-seed"}','tenant_job_failed') on conflict (id) do nothing`);
  console.log('Synthetic worker UI fixture ready at /admin/tenants/tenant_local');
} finally { await pool.end(); }
