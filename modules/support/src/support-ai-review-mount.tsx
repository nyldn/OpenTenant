import type { TenantId } from "@opentenant/auth";
import type { ModuleHostServices } from "@opentenant/database/module-host";
import { createSupportContext } from "./host-context";
import { supportAiCapabilities } from "./support-ai-api";
import { PgSupportAiReviewStore } from "./support-ai-review-store";
import { SupportAiReviewPanel } from "./support-ai-review-panel";

/** Server composition keeps reload reads within the current authorized page.
 * The shared module dispatcher currently exposes POST only; the dedicated API
 * also implements GET for the integrator's later dispatcher wiring.
 */
export async function SupportAiReviewMount({ host,ticketId,ticketVersion }: { host: ModuleHostServices; ticketId: string; ticketVersion: number }) {
  const gate = await createSupportContext(host)();
  if (!gate.ok) return null;
  const permissions = await supportAiCapabilities(host,gate.context);
  if (!permissions.suggest) return null;
  const {tenantId,session} = gate.context;
  const store = new PgSupportAiReviewStore((tenant,work) => host.withTenantDb(tenant as TenantId,work));
  try {
    const initialView = await store.read({ tenantId,actorId:session.userId,kind:"tenant_admin" },ticketId);
    return <SupportAiReviewPanel ticketId={ticketId} ticketVersion={ticketVersion} canReview={permissions.review} initialView={initialView} />;
  } catch {
    return <p role="alert" className="mt-6 text-sm">Suggestions could not be loaded. Reload to try again.</p>;
  }
}
