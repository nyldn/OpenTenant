import { currentSession } from "../../../../../lib/session";
import { currentTenant } from "../../../../../lib/tenant";
import { AccessDenied } from "@opentenant/design-system";
import { OwnerClaimForm } from "./claim-form";
export default async function OwnerClaimPage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { tenantId } = await params;
  const tenant = await currentTenant();
  if (tenant?.tenantId !== tenantId) return <AccessDenied state="forbidden" description="Open the invitation on its tenant host to claim ownership." action={{ href: "/", label: "Back to Home" }} />;
  const session = await currentSession();
  const query = await searchParams;
  const job = typeof query?.job === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(query.job) ? query.job : null;
  return <main className="mx-auto max-w-xl space-y-4 p-8"><h1 className="text-2xl font-bold">Claim tenant ownership</h1><p>Accept your identity invitation and sign in with the invited email, then enter the separate owner claim token supplied by your operator.</p>
    {session?.activeTenantId === tenantId ? <OwnerClaimForm tenantId={tenantId} initialJob={job} failed={query?.error === "unavailable"} /> : <a className="inline-flex min-h-11 items-center underline" href={`/auth/login?return=${encodeURIComponent(`/admin/tenants/${tenantId}/owner-claim`)}`}>Sign in with the invited email</a>}
  </main>;
}
