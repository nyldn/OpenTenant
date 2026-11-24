import { enforceRateLimit } from "../../../../../../../lib/rate-limit";
import { installationOwnerContext } from "../../../../../../../lib/installation-owner";
import { sameOrigin } from "../../../../../../../lib/settings-guard";
import { retryTenantJob, tenantJob } from "../../../../../../../lib/tenant-worker-store";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; jobId: string }> };
export async function GET(_req: Request, { params }: Context): Promise<Response> {
  const gate = await installationOwnerContext("owner.tenant.read");
  if (!gate.ok) return new Response("forbidden", { status: 403 });
  const { tenantId, jobId } = await params;
  const job = await tenantJob(jobId, tenantId);
  return job ? Response.json({ id: job.id, kind: job.kind, status: job.status, attempts: job.attempts, lastError: job.last_error }, { headers: { "cache-control": "no-store" } }) : new Response("Not found", { status: 404 });
}
export async function POST(req: Request, { params }: Context): Promise<Response> {
  const gate = await installationOwnerContext("owner.tenant.create");
  if (!gate.ok || !sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const limited = await enforceRateLimit(req, { tenantId: "installation", userId: gate.context.authority.userId, routeClass: "tenant-creation" });
  if (limited) return limited;
  const { tenantId, jobId } = await params;
  try { await retryTenantJob(tenantId, jobId, { kind: "installation_owner", userId: gate.context.authority.userId }); return Response.json({ jobId }, { status: 202 }); }
  catch { return new Response("Job is not retryable", { status: 409 }); }
}
