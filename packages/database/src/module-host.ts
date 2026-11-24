/** Reviewed native modules receive platform ports, never connection strings. */
import type { IdentitySession, TenantId } from "@opentenant/auth";
import type { AuditActor } from "@opentenant/security";
import type { AdmissionRequest, AdmissionPolicy, AdmissionDecision, AdmissionReleaseRequest, AdmissionReleaseResult, BrandSnapshot, ModuleAccessResult, ModelRouter } from "@opentenant/platform-core";
import type { PoolClient } from "pg";
export interface ModuleHostServices {
  currentTenant(): Promise<{ tenantId: string; displayName: string } | null>;
  currentSession(tenantId: TenantId): Promise<IdentitySession | null>;
  nativeModuleEnabled(tenantId: string, key: string): Promise<boolean>;
  resolvePermissions(session: IdentitySession, tenantId: string, key: string): Promise<string[]>;
  resolveModuleAccess(key: string, cookie: string | undefined): Promise<ModuleAccessResult>;
  accessCookieName(key: string): string;
  cookies(): Promise<{ get(name: string): { value: string } | undefined }>;
  unavailableTenantContext(): Promise<{ ok: false; reason: "no_tenant"; response?: Response }>;
  brandForTenant(tenantId: string): Promise<BrandSnapshot>;
  serverConfig(): Readonly<Record<string, string | undefined>>;
  withTenantDb<T>(tenantId: TenantId, work: (client: PoolClient) => Promise<T>): Promise<T>;
  modelRouter(): ModelRouter;
  sameOrigin(req: Request): boolean;
  auditActor(session: IdentitySession): AuditActor;
  audit(actor: AuditActor, tenantId: string | null, action: string, subject: string, detail?: Record<string, string | number | boolean | null>): Promise<void>;
  enforceMutationRateLimit(req: Request, context: { tenantId: string; session: IdentitySession }): Promise<Response | null>;
  readBoundedForm(req: Request, max: number): Promise<FormData | null>;
  admitPlatformRequest(request: AdmissionRequest, policy: AdmissionPolicy): Promise<AdmissionDecision | { admitted: false; code: "control_plane_unavailable" }>;
  releasePlatformAdmission(request: AdmissionReleaseRequest): Promise<AdmissionReleaseResult>;
}
