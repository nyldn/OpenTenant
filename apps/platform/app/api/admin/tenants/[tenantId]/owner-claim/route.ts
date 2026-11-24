import { hostBoundRequest } from "../../../../../../lib/better-auth-route";
import type { TenantId } from "@opentenant/auth";
import { currentSession } from "../../../../../../lib/session";
import { currentTenant } from "../../../../../../lib/tenant";
import { sameOrigin } from "../../../../../../lib/settings-guard";
import { readBoundedForm } from "../../../../../../lib/bounded-body";
import { claimTenantOwnerInvite, ownerClaimJobStatus } from "../../../../../../lib/tenant-owner-invite";
export const runtime = "nodejs";
const headers = { "cache-control": "no-store" };
const claimError = "This claim is unavailable. Use the separate owner token with the invited email. Ask your operator for a new token if it expired or was already used.";
function claimResponse(req: Request, tenantId: string, body: { jobId: string } | { error: string }, status: number): Response {
  if (!req.headers.get("accept")?.includes("text/html")) return Response.json(body, { status, headers });
  const query = new URLSearchParams("jobId" in body ? { job: body.jobId } : { error: "unavailable" });
  return new Response(null, { status: 303, headers: { ...headers, location: `/admin/tenants/${encodeURIComponent(tenantId)}/owner-claim?${query}` } });
}
async function binding(params: Promise<{ tenantId: string }>) {
  const { tenantId } = await params;
  const tenant = await currentTenant();
  if (tenant?.tenantId !== tenantId) return null;
  const session = await currentSession(tenant.tenantId as TenantId);
  return session ? { session, tenantId: tenant.tenantId } : null;
}
export async function POST(req: Request, { params }: { params: Promise<{ tenantId: string }> }): Promise<Response> {
  const { tenantId } = await params;
  const context = await binding(params);
  if (!context) return claimResponse(req, tenantId, { error: "Accept the invitation and sign in on this tenant host with the invited email." }, 403);
  req = hostBoundRequest(req);
  if (!sameOrigin(req)) return claimResponse(req, tenantId, { error: "Sign in on this tenant host and try again." }, 403);
  try {
    const form = await readBoundedForm(req);
    return claimResponse(req, tenantId, { jobId: await claimTenantOwnerInvite(context.tenantId, String(form?.get("token") ?? ""), context.session) }, 202);
  } catch {
    return claimResponse(req, tenantId, { error: claimError }, 400);
  }
}
/** Read only the claimant's durable owner-grant job, never arbitrary jobs. */
export async function GET(req: Request, { params }: { params: Promise<{ tenantId: string }> }): Promise<Response> {
  const context = await binding(params);
  if (!context) return Response.json({ error: "Sign in with the invited email." }, { status: 403, headers });
  const jobId = new URL(req.url).searchParams.get("job");
  if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(jobId)) return new Response(null, { status: 404, headers });
  const status = await ownerClaimJobStatus(context.tenantId, context.session.userId, jobId);
  return status ? Response.json({ status }, { headers }) : new Response(null, { status: 404, headers });
}
