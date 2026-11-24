import { installedModules } from "../../../../opentenant-modules";
import { enforceMutationRateLimit } from "../../../../lib/settings-rate-limit";
import { PgAuditStore } from "@opentenant/database";
import { hashPasscode } from "@opentenant/security";
import { sameOrigin } from "../../../../lib/settings-guard";
import { tenantAdminContext } from "../../../../lib/tenant-admin";
import { controlPlanePool, withControlPlaneTransaction } from "../../../../lib/control-plane";
import { writeModuleAccessPolicy } from "../../../../lib/tenant-settings-store";
import { readBoundedForm } from "../../../../lib/bounded-body";

export const runtime = "nodejs";

/** Switch a module's access mode; passcode mode always sets a fresh hash. */
export async function POST(req: Request): Promise<Response> {
  // Access-mode and passcode changes are credential/identity operations, not
  // routine managed-support configuration.
  const gate = await tenantAdminContext("module.access.configure");
  if (!gate.ok) return gate.response ?? new Response("forbidden", { status: 403 });
  if (!sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const limited = await enforceMutationRateLimit(req, gate.context); if (limited) return limited;
  const { tenant, auditActor: actor } = gate.context;

  const form = await readBoundedForm(req);
  const moduleKey = String(form?.get("moduleKey") ?? "");
  const mode = form?.get("mode");
  const passcode = String(form?.get("passcode") ?? "");

  if (!/^[a-z0-9-]{1,40}$/.test(moduleKey)) return new Response("bad module", { status: 400 });
  const definition = installedModules.get(moduleKey);
  if (!definition || (mode === "passcode" && !definition.permissions.passcode?.length)) return new Response("bad module", { status: 400 });
  if (mode !== "identity" && mode !== "passcode") return new Response("bad mode", { status: 400 });
  if (mode === "passcode" && (passcode.length < 8 || passcode.length > 64)) {
    return Response.redirect(new URL("/settings/modules?error=passcode", req.url), 303);
  }

  const passcodeHash = mode === "passcode" ? hashPasscode(passcode) : null;
  try {
    await withControlPlaneTransaction(async (client) => {
      await writeModuleAccessPolicy(client, {
        tenantId: tenant.tenantId,
        moduleKey,
        mode,
        passcodeHash,
      });
      await new PgAuditStore(controlPlanePool()).appendWithClient(client, {
        occurredAt: new Date(),
        actor,
        tenantId: tenant.tenantId,
        action: "module.access_mode_changed",
        subject: moduleKey,
        detail: {
          mode,
          passcodeRotated: mode === "passcode",
          supportSessionId: gate.context.managedSupport?.sessionId ?? null,
          supportReason: gate.context.managedSupport?.reason ?? null,
        },
      });
    });
  } catch {
    return new Response("internal error", { status: 500 });
  }

  return Response.redirect(new URL("/settings/modules", req.url), 303);
}
