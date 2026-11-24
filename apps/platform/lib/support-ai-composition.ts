import type { TenantId } from "@opentenant/auth";
import { PgTenantVoiceProfileStore } from "@opentenant/database";
import type { ModuleHostServices } from "@opentenant/database/module-host";
import { ModelResolutionError } from "@opentenant/platform-core";
import { createSupportAiApi, SUPPORT_MANIFEST, type AiDependencies } from "@opentenant/support";
import { controlPlanePool } from "./control-plane";

/** No ticket mutation or delivery port is provided to suggestion inference. */
export function supportAiDependencies(host: ModuleHostServices, tenantId: string): AiDependencies {
  const assertTenant = (tenant: string) => {
    if (tenant !== tenantId) throw new Error("Support AI tenant mismatch");
  };
  return {
    loadVoice: async tenant => {
      assertTenant(tenant);
      const snapshot = await new PgTenantVoiceProfileStore(controlPlanePool()).getCurrent(tenant as TenantId);
      if (!snapshot?.current) return undefined;
      if (snapshot.tenantId !== tenantId || snapshot.current.tenantId !== tenantId || snapshot.current.revocation) throw new Error("Support voice unavailable");
      return { version: snapshot.current.version, digest: snapshot.current.digest, bannedWords: snapshot.current.profile.bannedWords };
    },
    quarantine: async request => {
      assertTenant(request.tenant_id);
      throw new Error("Support owner quarantine unavailable");
    },
    inference: {
      prepare: async request => {
        assertTenant(request.tenant_id);
        // Resolve through the real tenant policy port, but never open inference
        // without independently recorded preparation/parent/consent evidence.
        await host.modelRouter().resolve({ tenantId: tenantId as TenantId, moduleId: SUPPORT_MANIFEST.key, useCase: "reviewed-suggestion", slot: "primary" });
        throw new ModelResolutionError("AUDIT_RECORDING_FAILED", "Support routing evidence unavailable");
      },
      open: async request => { assertTenant(request.tenant_id); throw new Error("Support routing evidence unavailable"); },
      verify: async () => false,
    },
  };
}

export async function handleSupportAiRequest(request: Request, host: ModuleHostServices): Promise<Response> {
  try {
    const tenant = await host.currentTenant();
    const session = tenant && await host.currentSession(tenant.tenantId as TenantId);
    if (!tenant || !session || session.isPlatformAdmin || session.activeTenantId !== tenant.tenantId
      || !(await host.resolvePermissions(session, tenant.tenantId, SUPPORT_MANIFEST.key)).includes("support.ai.suggest")) {
      return Response.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    // Preserve R6's explicit privileged tenant-local synthetic mode.
    const synthetic = await host.withTenantDb(tenant.tenantId as TenantId, async client =>
      (await client.query<{ synthetic: boolean }>("select synthetic from support.ai_controls where tenant_id=$1", [tenant.tenantId])).rows[0]?.synthetic === true);
    return createSupportAiApi(host, synthetic ? undefined : supportAiDependencies(host, tenant.tenantId))(request);
  } catch {
    return Response.json({ error: "suggestions are temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
