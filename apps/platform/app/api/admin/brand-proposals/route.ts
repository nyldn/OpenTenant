import { hostBoundRequest } from "../../../../lib/better-auth-route";
import { currentTenant } from "../../../../lib/tenant";
import { enforceMutationRateLimit } from "../../../../lib/settings-rate-limit";
import { authorizeBrandProposalAction, type TenantId } from "@opentenant/auth";
import {
  BrandProposalConflictError,
  BrandProposalSupersedeRequiredError,
  BrandProposalValidationError,
  PgBrandProposalStore,
} from "@opentenant/database";
import {
  isBrandTokenKey,
  parseBrandTokenInput,
  type BrandTokens,
} from "@opentenant/platform-core";
import { normalizeBrandSeedSource, queueBrandSeed } from "../../../../lib/brand-seed";
import {
  parseBrandDocumentUpload,
  readBrandDocumentUpload,
  type BrandDocumentUploadError,
} from "../../../../lib/brand-document-upload";
import { controlPlanePool } from "../../../../lib/control-plane";
import { auditActor, sameOrigin } from "../../../../lib/settings-guard";
import { brandProposalAdminContext } from "../../../../lib/tenant-admin";
import { readBoundedForm } from "../../../../lib/bounded-body";

export const runtime = "nodejs";

const NO_STORE_JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};

function uploadError(error: BrandDocumentUploadError): Response {
  return new Response(JSON.stringify({
    code: error.code,
    ...(error.issues ? { issues: error.issues } : {}),
  }), {
    status: error.status,
    headers: NO_STORE_JSON_HEADERS,
  });
}

function isLiveDraftConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const postgres = error as { code?: unknown; constraint?: unknown };
  return postgres.code === "23505"
    && postgres.constraint === "brand_proposals_one_live_draft";
}

export async function POST(req: Request): Promise<Response> {
  // Host resolution, never a form field, selects the authority tenant.
  const tenant = await currentTenant();
  if (!tenant) return new Response("forbidden", { status: 403 });
  req = hostBoundRequest(req);
  if (!sameOrigin(req)) return new Response("forbidden", { status: 403 });
  let form: FormData | null = null;
  if (/^multipart\/form-data\s*;/iu.test(req.headers.get("content-type") ?? "")) {
    const upload = await readBrandDocumentUpload(req);
    if (!upload.ok) return uploadError(upload.error);
    if (upload.value.kind === "form") {
      form = upload.value.form;
    } else {
      if (upload.value.tenantId !== tenant.tenantId) return new Response("forbidden", { status: 403 });
      const gate = await brandProposalAdminContext(
        tenant.tenantId as TenantId,
        "brand.proposal.upload",
      );
      if (!gate.ok) return new Response("forbidden", { status: 403 });
      const limited = await enforceMutationRateLimit(req, gate.context); if (limited) return limited;
      const { session, tenantId: trustedTenantId } = gate.context;
      const actor = auditActor(session);
      const uploadedAt = new Date();
      const parsed = parseBrandDocumentUpload(upload.value.bytes, session.userId, uploadedAt);
      if (!parsed.ok) return uploadError(parsed.error);
      try {
        const result = await new PgBrandProposalStore(controlPlanePool()).upload({
          tenantId: trustedTenantId,
          actor,
          fileDigest: parsed.value.fileDigest,
          parserVersion: parsed.value.parserVersion,
          uploadedAt,
          values: parsed.value.values,
          allowSupersede: authorizeBrandProposalAction(
            session,
            trustedTenantId,
            "brand.proposal.supersede",
          ).allowed,
        });
        const destination = new URL(
          `/admin/tenants/${trustedTenantId}/brand-proposals`,
          req.url,
        );
        destination.searchParams.set("upload", result.duplicate ? "duplicate" : "created");
        return Response.redirect(destination, 303);
      } catch (error) {
        if (error instanceof BrandProposalValidationError) {
          return uploadError({ code: "invalid_document", status: 422 });
        }
        if (error instanceof BrandProposalSupersedeRequiredError) {
          return new Response("forbidden", { status: 403 });
        }
        if (error instanceof BrandProposalConflictError) {
          return new Response(JSON.stringify({ code: "upload_conflict" }), {
            status: 409,
            headers: NO_STORE_JSON_HEADERS,
          });
        }
        return new Response(JSON.stringify({ code: "upload_failed" }), {
          status: 500,
          headers: NO_STORE_JSON_HEADERS,
        });
      }
    }
  }

  form ??= await readBoundedForm(req);
  const tenantId = tenant.tenantId;
  if (form?.get("tenantId") !== tenantId) return new Response("forbidden", { status: 403 });
  const proposalId = String(form?.get("proposalId") ?? "").toLowerCase();
  const action = form?.get("action");
  if (!/^[a-z][a-z0-9_-]{2,63}$/.test(tenantId)) {
    return new Response("bad tenant", { status: 400 });
  }
  if (
    action !== "request"
    && action !== "review"
    && action !== "edit"
    && action !== "discard"
    && action !== "apply"
  ) {
    return new Response("bad action", { status: 400 });
  }
  const permission = action === "request"
    ? "brand.proposal.upload"
    : action === "discard"
      ? "brand.proposal.revoke"
      : `brand.proposal.${action}` as const;
  const gate = await brandProposalAdminContext(tenantId as TenantId, permission);
  if (!gate.ok) {
    return new Response("forbidden", { status: 403 });
  }
  const limited = await enforceMutationRateLimit(req, gate.context); if (limited) return limited;
  const { session, tenantId: trustedTenantId } = gate.context;
  const actor = auditActor(session);

  const db = controlPlanePool();
  if (action === "request") {
    const sourceUrl = normalizeBrandSeedSource(String(form?.get("sourceUrl") ?? "").trim());
    if (!sourceUrl) return new Response("bad source", { status: 400 });
    try {
      await queueBrandSeed(db, trustedTenantId, sourceUrl, actor);
    } catch (error) {
      return new Response(
        isLiveDraftConflict(error)
          ? "discard the existing draft before requesting another source"
          : "seed request failed",
        { status: isLiveDraftConflict(error) ? 409 : 500 },
      );
    }
    return Response.redirect(
      new URL(`/admin/tenants/${trustedTenantId}/brand-proposals`, req.url),
      303,
    );
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(proposalId)) {
    return new Response("bad proposal", { status: 400 });
  }
  if (action === "apply") {
    const reason = String(form?.get("reason") ?? "").trim();
    if (reason.length === 0 || reason.length > 1000) {
      return new Response("bad reason", { status: 400 });
    }
    try {
      await new PgBrandProposalStore(db).apply({
        proposalId,
        tenantId: trustedTenantId,
        actor,
        reason,
        appliedAt: new Date(),
      });
    } catch (error) {
      return new Response(
        error instanceof BrandProposalConflictError ? error.message : "internal error",
        { status: error instanceof BrandProposalConflictError ? 409 : 500 },
      );
    }
    return Response.redirect(
      new URL(`/admin/tenants/${trustedTenantId}/brand-proposals`, req.url),
      303,
    );
  }

  const reason = String(form?.get("reason") ?? "").trim();
  if (reason.length === 0 || reason.length > 1000) {
    return new Response("bad reason", { status: 400 });
  }
  try {
    const store = new PgBrandProposalStore(db);
    if (action === "review") {
      await store.review({
        proposalId,
        tenantId: trustedTenantId,
        actor,
        reason,
      });
    } else if (action === "edit") {
      const values: Partial<BrandTokens> = {};
      for (const [name, rawValue] of form?.entries() ?? []) {
        if (!name.startsWith("value.")) continue;
        const key = name.slice("value.".length);
        if (!isBrandTokenKey(key)) return new Response("bad values", { status: 400 });
        if (typeof rawValue !== "string") return new Response("bad values", { status: 400 });
        const parsed = parseBrandTokenInput(key, rawValue);
        if (!parsed.ok) return new Response("bad values", { status: 400 });
        (values as Record<string, unknown>)[key] = parsed.value;
      }
      if (Object.keys(values).length === 0) {
        return new Response("bad values", { status: 400 });
      }
      await store.edit({
        proposalId,
        tenantId: trustedTenantId,
        actor,
        reason,
        values,
      });
    } else {
      await store.revoke({
        proposalId,
        tenantId: trustedTenantId,
        actor,
        reason,
      });
    }
  } catch (error) {
    const body = error instanceof BrandProposalConflictError
      ? error.message
      : error instanceof BrandProposalValidationError
        ? "bad values"
        : "internal error";
    const status = error instanceof BrandProposalConflictError
      ? 409
      : error instanceof BrandProposalValidationError
        ? 400
        : 500;
    return new Response(body, { status });
  }

  return Response.redirect(
    new URL(`/admin/tenants/${trustedTenantId}/brand-proposals`, req.url),
    303,
  );
}
