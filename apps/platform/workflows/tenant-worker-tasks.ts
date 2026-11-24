import type { ProvisionInput } from "../lib/provisioning";
import type { TenantWorkerJob } from "../lib/tenant-worker-store";

/** One archive at a time per process, including direct reconciliation callers.
 * A failed/cancelled export releases the next waiter without poisoning it.
 */
export function createTenantExportRunner(exportJob: (job: TenantWorkerJob, signal?: AbortSignal) => Promise<void>) {
  let tail: Promise<void> = Promise.resolve();
  return (job: TenantWorkerJob, signal?: AbortSignal): Promise<void> => {
    const result = tail.then(async () => {
      signal?.throwIfAborted();
      await exportJob(job, signal);
    });
    tail = result.catch(() => undefined);
    return result;
  };
}

/** Checkpoints are owned by each step; replay never activates before bootstrap. */
export async function executeProvisioningJob(input: ProvisionInput, deps: {
  provision(input: ProvisionInput): Promise<unknown>;
  inviteOwner(): Promise<unknown>;
  activate(): Promise<unknown>;
}): Promise<void> {
  await deps.provision(input);
  await deps.inviteOwner();
  await deps.activate();
}
