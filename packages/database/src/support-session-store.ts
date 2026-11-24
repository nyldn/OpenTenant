import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { ManagedSupportSession, SupportActionClass } from "@opentenant/auth";

export interface CreateSupportSession {
  tenantId: string;
  operatorUserId: string;
  reason: string;
  reference: string | null;
  allowedActionClasses: ReadonlyArray<SupportActionClass>;
  expiresAt: Date;
}

interface SupportSessionRow extends QueryResultRow {
  session_id: string;
  installation_id: string;
  tenant_id: string;
  operator_user_id: string;
  reason: string;
  reference: string | null;
  allowed_action_classes: SupportActionClass[] | null;
  created_at: Date | string;
  last_activity_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
}

type SupportSessionQuery = (
  text: string,
  values: unknown[],
) => Promise<{ rows: SupportSessionRow[] }>;

export class PgSupportSessionStore {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateSupportSession): Promise<{ token: string; session: ManagedSupportSession } | null> {
    return this.insert((text, values) => this.pool.query<SupportSessionRow>(text, values), input);
  }

  async createWithClient(
    client: PoolClient,
    input: CreateSupportSession,
  ): Promise<{ token: string; session: ManagedSupportSession } | null> {
    return this.insert((text, values) => client.query<SupportSessionRow>(text, values), input);
  }

  private async insert(
    query: SupportSessionQuery,
    input: CreateSupportSession,
  ): Promise<{ token: string; session: ManagedSupportSession } | null> {
    const token = randomBytes(32).toString("base64url");
    const sessionId = `sup_${randomUUID()}`;
    const { rows } = await query(
      `insert into managed_support_sessions
        (session_id, token_hash, installation_id, tenant_id, operator_user_id, reason, reference, allowed_action_classes, expires_at)
       select $1, $2, installation.installation_id, tenant.tenant_id, $4, $5, $6, $7::jsonb, $8
       from installation_metadata installation
       join tenants tenant on tenant.tenant_id = $3 and tenant.managed_support_enabled = true
       returning *`,
      [sessionId, tokenHash(token), input.tenantId, input.operatorUserId, input.reason, input.reference, JSON.stringify(input.allowedActionClasses), input.expiresAt],
    );
    return rows[0] ? { token, session: rowToSession(rows[0]) } : null;
  }

  async findActive(token: string): Promise<ManagedSupportSession | null> {
    const { rows } = await this.pool.query(
      `update managed_support_sessions set last_activity_at = now()
       where token_hash = $1
         and installation_id = (select installation_id from installation_metadata where singleton = true)
         and revoked_at is null and expires_at > now()
       returning *`,
      [tokenHash(token)],
    );
    return rows[0] ? rowToSession(rows[0]) : null;
  }

  async revoke(token: string, operatorUserId: string): Promise<ManagedSupportSession | null> {
    return this.revokeRecord(
      (text, values) => this.pool.query<SupportSessionRow>(text, values),
      token,
      operatorUserId,
    );
  }

  async revokeWithClient(
    client: PoolClient,
    token: string,
    operatorUserId: string,
  ): Promise<ManagedSupportSession | null> {
    return this.revokeRecord(
      (text, values) => client.query<SupportSessionRow>(text, values),
      token,
      operatorUserId,
    );
  }

  private async revokeRecord(
    query: SupportSessionQuery,
    token: string,
    operatorUserId: string,
  ): Promise<ManagedSupportSession | null> {
    const { rows } = await query(
      `update managed_support_sessions set revoked_at = now()
       where token_hash = $1 and operator_user_id = $2
         and installation_id = (select installation_id from installation_metadata where singleton = true)
         and revoked_at is null returning *`,
      [tokenHash(token), operatorUserId],
    );
    return rows[0] ? rowToSession(rows[0]) : null;
  }
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function rowDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function rowToSession(row: SupportSessionRow): ManagedSupportSession {
  return {
    sessionId: row.session_id,
    installationId: row.installation_id,
    tenantId: row.tenant_id,
    operatorUserId: row.operator_user_id,
    reason: row.reason,
    reference: row.reference,
    allowedActionClasses: Array.isArray(row.allowed_action_classes) ? row.allowed_action_classes : [],
    createdAt: rowDate(row.created_at),
    lastActivityAt: rowDate(row.last_activity_at),
    expiresAt: rowDate(row.expires_at),
    revokedAt: row.revoked_at === null ? null : rowDate(row.revoked_at),
  };
}
