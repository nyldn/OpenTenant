import { PgAuditStore } from "@opentenant/database";
import type { AuditActor } from "@opentenant/security";
import { ControlPlaneCommitError, controlPlanePool, withControlPlaneTransaction } from "./control-plane";

type CommitEvidence = { sequence: number; hash: string };
export class TenantActivationOutcomeUnknownError extends Error {
  constructor() { super("Tenant activation commit outcome is unknown"); this.name = "TenantActivationOutcomeUnknownError"; }
}

export async function activateProvisionedTenant(input: {
  tenantId: string;
  slug: string;
  actor: AuditActor;
}): Promise<void> {
  const db = controlPlanePool();
  let evidence: CommitEvidence | undefined;

  try {
    await withControlPlaneTransaction(async (client) => {
      const activation = await client.query<{ tenant_id: string }>(
        `update tenants
            set status='active', updated_at=now()
          where tenant_id=$1 and status='provisioning'
        returning tenant_id`,
        [input.tenantId],
      );
      if (activation.rows.length !== 1) throw new Error("Tenant is no longer provisioning");
      const event = await new PgAuditStore(db).appendWithClient(client, {
        occurredAt: new Date(),
        actor: input.actor,
        tenantId: input.tenantId,
        action: "tenant.provisioned",
        subject: input.slug,
        detail: {},
      });
      evidence = { sequence: event.sequence, hash: event.hash };
    });
  } catch (error) {
    if (!(error instanceof ControlPlaneCommitError) || !evidence) throw error;
    await reconcileActivationCommit(input, evidence, error);
  }
}

async function reconcileActivationCommit(
  input: { tenantId: string; slug: string },
  evidence: CommitEvidence,
  commitError: ControlPlaneCommitError,
): Promise<void> {
  try {
    const { rows } = await controlPlanePool().query<{
      status: string | null;
      provisioned: boolean;
    }>(
      `select (select t.status from tenants t where t.tenant_id = $1) as status,
              exists (
                select 1
                  from audit_events e
                 where e.tenant_id = $1
                   and e.action = 'tenant.provisioned'
                   and e.subject = $2
                   and e.sequence = $3
                   and e.hash = $4
              ) as provisioned`,
      [input.tenantId, input.slug, evidence.sequence, evidence.hash],
    );
    const row = rows.length === 1 ? rows[0] : undefined;
    if (row?.status === "active" && row.provisioned) return;
    if (row?.status === "provisioning" && !row.provisioned) throw commitError;
    throw new TenantActivationOutcomeUnknownError();
  } catch (error) {
    if (error === commitError || error instanceof TenantActivationOutcomeUnknownError) throw error;
    throw new TenantActivationOutcomeUnknownError();
  }
}
