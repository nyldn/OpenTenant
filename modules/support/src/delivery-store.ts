import type { AuditActor } from "@opentenant/security";
import type { SupportClient } from "./ticket-store";
import { EMAIL_LEASE_SECONDS, EMAIL_MAX_ATTEMPTS, emailFailure, type EmailDeliveryStatus } from "./delivery-state";
import type { DeliverySafeErrorClass } from "./support-depth-types";

export interface QueuedSupportEmail {
  id: string;
  tenant_id: string;
  ticket_id: string;
  ticket_number: string;
  event: "created" | "reply";
  destination_ref: string;
  idempotency_key: string;
  status: EmailDeliveryStatus;
  attempts: number;
  lease_token: string;
  safe_error: DeliverySafeErrorClass | null;
}

/** Each callback must commit a short transaction on one tenant-bound client. */
export type SupportDeliveryTransaction = <T>(tenantId: string, work: (client: SupportClient) => Promise<T>) => Promise<T>;
const workerActor = JSON.stringify({ kind: "system", job: "support_email_delivery" });

export class PgSupportDeliveryStore {
  constructor(private readonly transaction: SupportDeliveryTransaction) {}

  async claim(tenantId: string): Promise<QueuedSupportEmail | null> {
    return this.transaction(tenantId, async client => {
      // A process that dies on its final attempt must still reach a terminal state.
      await client.query(
        `with exhausted as (
           update support.email_deliveries set status = 'failed', safe_error = 'transient',
             lease_token = null, lease_until = null
           where tenant_id = $1 and status = 'sending' and lease_until <= clock_timestamp()
             and attempts >= $2 returning *
         ) insert into support.email_delivery_events (tenant_id, delivery_id, actor, action, attempt, safe_error)
           select tenant_id, id, $3::jsonb, 'failed', total_attempts, 'transient' from exhausted`,
        [tenantId, EMAIL_MAX_ATTEMPTS, workerActor],
      );
      const { rows } = await client.query<QueuedSupportEmail>(
        `update support.email_deliveries d set status = 'sending', safe_error = null,
           lease_token = gen_random_uuid(), lease_until = clock_timestamp() + make_interval(secs => $2),
           attempts = d.attempts + 1, total_attempts = d.total_attempts + 1
         where d.tenant_id = $1 and d.id = (
           select id from support.email_deliveries
            where tenant_id = $1 and attempts < $3 and (
              (status in ('pending', 'retry') and next_attempt_at <= clock_timestamp())
              or (status = 'sending' and lease_until <= clock_timestamp()))
            order by next_attempt_at, id for update skip locked limit 1
         ) returning d.*`,
        [tenantId, EMAIL_LEASE_SECONDS, EMAIL_MAX_ATTEMPTS],
      );
      return rows[0] ?? null;
    });
  }

  /** Recheck preference and fence ownership immediately before contacting SMTP. */
  async ready(delivery: QueuedSupportEmail): Promise<boolean> {
    return this.transaction(delivery.tenant_id, async client => {
      const { rows } = await client.query(
        `select d.id from support.email_deliveries d
          join support.delivery_preferences p on p.tenant_id = d.tenant_id
           and p.subject_id = d.subject_id and p.channel = 'email'
          where d.tenant_id = $1 and d.id = $2 and d.lease_token = $3
            and d.status = 'sending' and d.lease_until > clock_timestamp()
            and p.enabled and p.destination_ref = d.destination_ref`,
        [delivery.tenant_id, delivery.id, delivery.lease_token],
      );
      return rows.length === 1;
    });
  }

  async settle(delivery: QueuedSupportEmail, result: { ok: true } | { ok: false; safeErrorClass: unknown }): Promise<boolean> {
    const failure = emailFailure(delivery.attempts, result.ok ? null : result.safeErrorClass);
    const status = result.ok ? "delivered" : failure.status;
    const error = result.ok ? null : failure.safeError;
    return this.transaction(delivery.tenant_id, async client => {
      const { rows } = await client.query(
        `with settled as (
           update support.email_deliveries set status = $4, safe_error = $5,
             next_attempt_at = clock_timestamp() + make_interval(secs => $6),
             lease_token = null, lease_until = null,
             delivered_at = case when $4 = 'delivered' then clock_timestamp() else null end
           where tenant_id = $1 and id = $2 and lease_token = $3
             and status = 'sending' and lease_until > clock_timestamp() returning *
         ) insert into support.email_delivery_events (tenant_id, delivery_id, actor, action, attempt, safe_error)
           select tenant_id, id, $7::jsonb, status, total_attempts, safe_error from settled returning id`,
        [delivery.tenant_id, delivery.id, delivery.lease_token, status, error, failure.delaySeconds, workerActor],
      );
      return rows.length === 1;
    });
  }
}

/** Safe ticket-local visibility. Call only after the ticket read and staff gates. */
export async function listTicketEmailDeliveries(client: SupportClient, tenantId: string, ticketId: string) {
  // Read compatibility while the integrator rolls the forward migration out.
  // Do not catch SQL errors: they abort the caller's transaction.
  const schema = await client.query<{ installed: boolean }>(
    "select to_regclass('support.email_deliveries') is not null as installed",
  );
  if (!schema.rows[0]?.installed) return [];
  const { rows } = await client.query<Pick<QueuedSupportEmail, "id" | "event" | "status" | "attempts" | "safe_error">>(
    `select id, event, status, attempts, safe_error from support.email_deliveries
      where tenant_id = $1 and ticket_id = $2 order by created_at desc limit 50`,
    [tenantId, ticketId],
  );
  return rows;
}

/** The state reset and full actor attribution commit together, including managed support. */
export async function retryTicketEmail(client: SupportClient, input: {
  tenantId: string; ticketId: string; deliveryId: string; actor: AuditActor;
}): Promise<boolean> {
  const { rows } = await client.query(
    `with retried as (
       update support.email_deliveries set status = 'pending', attempts = 0,
         manual_retries = manual_retries + 1, safe_error = null, next_attempt_at = clock_timestamp()
       where tenant_id = $1 and ticket_id = $2 and id = $3 and status = 'failed' returning *
     ) insert into support.email_delivery_events (tenant_id, delivery_id, actor, action, attempt)
       select tenant_id, id, $4::jsonb, 'manual_retry', total_attempts from retried returning id`,
    [input.tenantId, input.ticketId, input.deliveryId, JSON.stringify(input.actor)],
  );
  return rows.length === 1;
}
