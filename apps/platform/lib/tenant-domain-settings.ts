import { controlPlanePool } from "./control-plane";

export interface TenantDomainSetting {
  host: string;
  kind: "opentenant_subdomain" | "custom";
  verification: "pending" | "verified" | "failed";
  active: boolean;
  challengeRecord: string | null;
  challengeExpiresAt: string | null;
  displayLabel: string | null;
  verificationNote: string | null;
}

/** Reads real domain records; metadata never controls verification or routing. */
export async function tenantDomainSettings(tenantId: string): Promise<TenantDomainSetting[]> {
  const { rows } = await controlPlanePool().query<{
    host: string;
    kind: TenantDomainSetting["kind"];
    verification: TenantDomainSetting["verification"];
    active: boolean;
    challenge_record: string | null;
    challenge_expires_at: Date | null;
    display_label: string | null;
    verification_note: string | null;
  }>(
    `select host, kind, verification, active, display_label, verification_note, challenge_record, challenge_expires_at
       from domains where tenant_id = $1 order by host`,
    [tenantId],
  );
  return rows.map((row) => ({
    host: row.host,
    kind: row.kind,
    verification: row.verification,
    active: row.active,
    challengeRecord: row.challenge_record,
    challengeExpiresAt: row.challenge_expires_at?.toISOString() ?? null,
    displayLabel: row.display_label,
    verificationNote: row.verification_note,
  }));
}
