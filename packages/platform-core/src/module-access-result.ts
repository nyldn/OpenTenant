import type { IdentitySession, TenantId } from "@opentenant/auth";
interface VerifiedPasscodePrincipal { kind: "passcode"; principalId: string; tenantId: string; moduleKey: string; }
export type ModuleAccessResult =
  | {
      ok: true;
      tenantId: TenantId;
      mode: "identity";
      principal: {
        kind: "identity";
        principalId: string;
        session: IdentitySession;
      };
    }
  | {
      ok: true;
      tenantId: TenantId;
      mode: "passcode";
      principal: VerifiedPasscodePrincipal;
    }
  | { ok: false; reason: "no_tenant" }
  | { ok: false; reason: "unavailable"; tenantId: TenantId }
  | { ok: false; reason: "anonymous" | "forbidden"; tenantId: TenantId; mode: "identity" }
  | { ok: false; reason: "passcode_required"; tenantId: TenantId; mode: "passcode" };
