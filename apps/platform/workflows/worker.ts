import { run, runMigrations, runOnce } from "graphile-worker";
import { controlPlanePool } from "../lib/control-plane";
import { tenantWorkerTasks, TENANT_WORKER_CRONTAB } from "./tenant-worker";

const db = controlPlanePool();
// Abort running tasks as shutdown starts, then let Graphile await cleanup.
const options = { pgPool: db, taskList: tenantWorkerTasks, crontab: TENANT_WORKER_CRONTAB, concurrency: 2, pollInterval: 1000, noHandleSignals: false, gracefulShutdownAbortTimeout: 0 };
try {
  if (process.argv.includes("--migrate")) await runMigrations(options);
  else if (process.argv.includes("--once")) await runOnce(options);
  else { const runner = await run(options); await runner.promise; }
} catch {
  process.stderr.write("Worker failed. Check database migrations and installation configuration.\n");
  process.exitCode = 1;
} finally { await db.end(); }
