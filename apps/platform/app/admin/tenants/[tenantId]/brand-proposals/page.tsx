import { AccessDenied } from "@opentenant/design-system";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { TenantId } from "@opentenant/auth";
import { isBrandTokenKey } from "@opentenant/platform-core";
import { brandProposalTenantContext } from "../../../../../lib/tenant-admin";
import { brandProposalPageRows, type BrandProposalPageRow } from "../../../../../lib/brand-proposal-read-model";
import BrandDocumentUploadForm from "./brand-document-upload-form";

export const dynamic = "force-dynamic";

interface DisplayValue {
  key: string;
  value: string;
  provenance: string;
  locked: boolean;
}

function displayValues(
  value: unknown,
  lockedKeys: ReadonlySet<string>,
  source: BrandProposalPageRow["source"],
): DisplayValue[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const result: DisplayValue[] = [];
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    const provenance = source?.kind === "upload"
      ? `SHA-256 ${source.fileDigest}`
      : source?.kind === "https"
        ? `${source.sourceUrl}${source.retrievedAt ? ` · retrieved ${source.retrievedAt.toISOString()}` : ""}`
        : null;
    if (!provenance) continue;
    result.push({
      key,
      value: typeof record.value === "string" ? record.value : JSON.stringify(record.value),
      provenance,
      locked: lockedKeys.has(key),
    });
  }
  return result;
}

function statusLabel(value: string | null): string {
  if (!value) return "Unknown";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default async function BrandProposalsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  if (!/^[a-z][a-z0-9_-]{2,63}$/.test(tenantId)) redirect("/admin");
  const gate = await brandProposalTenantContext(tenantId as TenantId);
  if (!gate.ok) {
    return <AccessDenied state={gate.reason === "anonymous" ? "signed-out" : "forbidden"}
      description="Brand proposals require an owner or administrator membership in this tenant. Sign in on the tenant host to select its organization."
      action={{ href: gate.reason === "anonymous" ? `/auth/login?return=/admin/tenants/${tenantId}/brand-proposals` : "/settings/branding", label: gate.reason === "anonymous" ? "Sign in" : "Back to Branding" }} />;
  }
  const permissions = new Set(gate.context.session.permissions);
  const rows: BrandProposalPageRow[] = await brandProposalPageRows(tenantId);
  const tenant = rows[0];
  if (!tenant) redirect("/admin");
  const proposals = rows.filter((row) => row.proposal_id !== null);

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/opentenant-logo.svg" alt="opentenant" className="h-5 w-auto" />
            <span className="text-sm font-semibold text-muted-foreground">Brand proposals</span>
          </div>
          <Link href="/settings/branding" className="inline-flex min-h-11 items-center rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">
            Back to Branding
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Tenant brand</p>
          <h1 className="mt-2 font-display text-2xl font-bold sm:text-3xl">{tenant.display_name}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Review proposed values against their source before they affect the active tenant brand. Uploads, edits, reviews, applies, and discards are separate human actions.
          </p>
        </div>

        {permissions.has("brand.proposal.upload") ? (
          <>
            <BrandDocumentUploadForm tenantId={tenantId} />
            <form method="POST" action="/api/admin/brand-proposals" className="mt-4 rounded-xl border border-border bg-card p-5 sm:p-6">
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="action" value="request" />
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">HTTPS source</p>
              <label className="mt-2 block text-sm font-medium">
                <span className="mb-2 block">Website URL</span>
                <input
                  name="sourceUrl"
                  type="url"
                  inputMode="url"
                  required
                  placeholder="https://www.example.test"
                  className="min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                />
              </label>
              <p className="mt-2 text-xs text-muted-foreground">
                Queue a separate inactive proposal from an HTTPS source. No website values are applied automatically.
              </p>
              <button className="mt-3 min-h-11 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">
                Request proposal
              </button>
            </form>
          </>
        ) : null}

        <div className="mt-6 space-y-4">
          {proposals.length === 0 ? (
            <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
              No brand proposals have been requested.
            </p>
          ) : null}
          {proposals.map((proposal) => {
            const lockedKeys = new Set(
              Array.isArray(proposal.locked_keys)
                ? proposal.locked_keys.filter((key): key is string => typeof key === "string")
                : [],
            );
            const values = displayValues(proposal.proposed_values, lockedKeys, proposal.source);
            const editableValues = values.filter(
              (value) => !value.locked && isBrandTokenKey(value.key),
            );
            const proposalId = proposal.proposal_id as string;
            return (
              <section
                key={proposalId}
                className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6"
                aria-labelledby={`proposal-${proposalId}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 id={`proposal-${proposalId}`} className="font-display text-lg font-semibold">
                      {proposal.source?.kind === "upload" ? "Uploaded brand.md" : "Website proposal"}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Request: {statusLabel(proposal.request_status)}
                    </p>
                  </div>
                  <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold">
                    {statusLabel(proposal.proposal_status)}
                  </span>
                </div>

                <dl className="mt-5 grid gap-3 border-y border-border py-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source kind</dt>
                    <dd className="mt-1 font-mono text-xs">{proposal.source?.kind ?? "unknown"}</dd>
                  </div>
                  {proposal.source?.kind === "upload" ? (
                    <>
                      <div className="sm:col-span-2">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SHA-256 digest</dt>
                        <dd className="mt-1 break-all font-mono text-xs">{proposal.source.fileDigest}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parser</dt>
                        <dd className="mt-1 font-mono text-xs">{proposal.source.parserVersion}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Uploaded by</dt>
                        <dd className="mt-1 break-all">{proposal.source.uploadedByUserId}</dd>
                        <dd className="text-xs text-muted-foreground">{proposal.source.uploadedAt.toISOString()}</dd>
                      </div>
                    </>
                  ) : (
                    <div className="sm:col-span-3">
                      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source URL</dt>
                      <dd className="mt-1 break-all font-mono text-xs">{proposal.source?.sourceUrl ?? proposal.source_url ?? "Unavailable"}</dd>
                      {proposal.source?.retrievedAt ? <dd className="text-xs text-muted-foreground">Retrieved {proposal.source.retrievedAt.toISOString()}</dd> : null}
                    </div>
                  )}
                </dl>

                {proposal.proposal_status === "applied" ? (
                  <p className="mt-4 rounded-md border border-border bg-background px-3 py-2 text-sm">
                    Applied to the active tenant brand.
                  </p>
                ) : null}

                {values.length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">Waiting for seed values. Nothing is active.</p>
                ) : (
                  <dl className="mt-4 space-y-3">
                    {values.map((item) => (
                      <div key={item.key} className="rounded-md border border-border p-3">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{item.key}</dt>
                        <dd className="mt-1 text-sm">{item.value}</dd>
                        {item.locked ? (
                          <dd className="mt-1 text-xs font-medium text-danger-text">
                            Rejected: locked by policy
                          </dd>
                        ) : null}
                        <dd className="mt-2 break-all font-mono text-xs text-muted-foreground">
                          {item.provenance}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}

                {editableValues.length > 0
                  && (proposal.proposal_status === "draft" || proposal.proposal_status === "reviewed")
                  && permissions.has("brand.proposal.edit") ? (
                  <form method="POST" action="/api/admin/brand-proposals" className="mt-4 space-y-3 rounded-md border border-border p-3">
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="proposalId" value={proposalId} />
                    <input type="hidden" name="action" value="edit" />
                    <p className="text-xs text-muted-foreground">
                      Editing preserves the source evidence and returns this proposal to draft for a new review.
                    </p>
                    {editableValues.map((item) => (
                      <label key={item.key} className="block text-sm">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {item.key}
                        </span>
                        <input
                          name={`value.${item.key}`}
                          required
                          defaultValue={item.value}
                          className="min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                        />
                      </label>
                    ))}
                    <label className="block text-sm">
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Edit reason
                      </span>
                      <input
                        name="reason"
                        required
                        maxLength={1000}
                        className="min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                      />
                    </label>
                    <button className="inline-flex min-h-11 items-center rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">
                      Save edits and require new review
                    </button>
                  </form>
                ) : null}

                {proposal.proposal_status === "draft" ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {values.length > 0 && permissions.has("brand.proposal.review") ? (
                      <form method="POST" action="/api/admin/brand-proposals" className="space-y-2">
                        <input type="hidden" name="tenantId" value={tenantId} />
                        <input type="hidden" name="proposalId" value={proposalId} />
                        <input type="hidden" name="action" value="review" />
                        <label className="block text-sm">
                          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Review reason
                          </span>
                          <input
                            name="reason"
                            required
                            maxLength={1000}
                            className="min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                          />
                        </label>
                        <button className="min-h-11 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
                          Review proposal
                        </button>
                      </form>
                    ) : null}
                    {permissions.has("brand.proposal.revoke") ? (
                      <form method="POST" action="/api/admin/brand-proposals" className="space-y-2">
                        <input type="hidden" name="tenantId" value={tenantId} />
                        <input type="hidden" name="proposalId" value={proposalId} />
                        <input type="hidden" name="action" value="discard" />
                        <label className="block text-sm">
                          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Revoke reason
                          </span>
                          <input
                            name="reason"
                            required
                            maxLength={1000}
                            className="min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                          />
                        </label>
                        <button className="inline-flex min-h-11 items-center rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">
                          Discard proposal
                        </button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
                {proposal.proposal_status === "reviewed" ? (
                  <div className="mt-4 space-y-3">
                    {permissions.has("brand.proposal.apply")
                      && proposal.reviewed_policy_version !== proposal.policy_version ? (
                      <p className="text-sm font-medium text-danger-text">
                        The brand policy changed after review. Review a fresh proposal before applying.
                      </p>
                    ) : permissions.has("brand.proposal.apply") ? (
                      <form method="POST" action="/api/admin/brand-proposals" className="space-y-2">
                        <input type="hidden" name="tenantId" value={tenantId} />
                        <input type="hidden" name="proposalId" value={proposalId} />
                        <input type="hidden" name="action" value="apply" />
                        <label className="block text-sm">
                          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Apply reason
                          </span>
                          <input
                            name="reason"
                            required
                            maxLength={1000}
                            className="min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                          />
                        </label>
                        <button className="min-h-11 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
                          Apply {values.filter((value) => !value.locked).length} unlocked values
                        </button>
                      </form>
                    ) : null}
                    {permissions.has("brand.proposal.revoke") ? (
                      <form method="POST" action="/api/admin/brand-proposals" className="space-y-2">
                        <input type="hidden" name="tenantId" value={tenantId} />
                        <input type="hidden" name="proposalId" value={proposalId} />
                        <input type="hidden" name="action" value="discard" />
                        <label className="block text-sm">
                          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Revoke reason
                          </span>
                          <input
                            name="reason"
                            required
                            maxLength={1000}
                            className="min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                          />
                        </label>
                        <button className="inline-flex min-h-11 items-center rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">
                          Discard proposal
                        </button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
