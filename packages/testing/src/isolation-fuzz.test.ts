import { randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { Pool } from "pg";
import type { TenantId } from "@opentenant/auth";
import { CredentialCipher, PgAdmissionStore, PgAuditStore, PgBrandProposalStore, PgModuleCapabilityStore, PgModuleOwnershipStore, PgTenantVoiceProfileStore, PgUsageLedger, withTenantContext } from "@opentenant/database";
import { createUsageMetricRegistry } from "@opentenant/platform-core";
import { NeonProvisioner } from "@opentenant/provisioning";
import { applyMigrations } from "@opentenant/migrations";
import { createTicket, getTicket, setStatus } from "../../../modules/support/src/ticket-store";
import { loadControlPlaneMigrations } from "../../../tooling/migrations/src/local.mjs";
import { provisionTenantProject } from "../../../apps/platform/lib/provisioning";

const controlUrl = process.env.ISOLATION_CONTROL_DATABASE_URL;
const tenantUrl = process.env.ISOLATION_TENANT_DATABASE_URL;
const otherTenantUrl = process.env.ISOLATION_OTHER_TENANT_DATABASE_URL;
const enabled = controlUrl && tenantUrl && otherTenantUrl;
if (process.env.CI && !enabled && process.env.ISOLATION_FUZZ_REQUIRED === "1") throw new Error("isolation fuzz requires both database URLs");
const seed = process.env.ISOLATION_FUZZ_SEED === undefined ? (process.env.CI ? 20261111 : randomInt(0x7fffffff)) : Number(process.env.ISOLATION_FUZZ_SEED);
if (!Number.isSafeInteger(seed)) throw new Error("invalid isolation fuzz seed");
const tenants = ["tenant_fuzz_a", "tenant_fuzz_b"] as TenantId[];
const actor = { kind: "user" as const, userId: "user_fuzz" };
const metrics = createUsageMetricRegistry([{ metricId: "module.executions", unit: "execution", description: "Synthetic executions" }]);
const profile = { readingLevel: "professional" as const, formality: "neutral" as const, person: "second" as const, tense: "present" as const, sentenceLength: "medium" as const, bannedWords: [], preferredWords: [], exampleRewrites: [] };
const policy = { maxRequests: 1000, windowMs: 60_000, maxConcurrent: 1000, leaseMs: 1000, idempotencyTtlMs: 1000, maxIdempotencyEntriesPerScope: 1000, maxSizeBytes: 1000 };
const families = ["support", "brand", "voice", "audit", "usage", "admission", "capabilities"] as const;
type Family = typeof families[number];
const tables: Record<Family, readonly string[]> = {
  support: ["support.tickets", "support.ticket_events", "support.outbox_events"],
  brand: ["brand_proposals", "brand_seed_requests"],
  voice: ["tenant_voice_profiles", "tenant_voice_profile_versions", "tenant_voice_profile_revocations"],
  audit: ["audit_events"], usage: ["exact_usage_events", "usage_metric_definitions"],
  admission: ["admission_policies", "admission_windows", "admission_leases", "admission_idempotency_records"],
  capabilities: ["tenant_module_capability_grants", "module_creator_capability_authorities"],
};

(enabled ? describe : describe.skip)("cross-tenant isolation against provisioned PostgreSQL", () => {
  if (!controlUrl || !tenantUrl || !otherTenantUrl) return;
  for (const [value, database] of [[controlUrl, "opentenant_it_fuzz_control"], [tenantUrl, "opentenant_it_fuzz_tenant"], [otherTenantUrl, "opentenant_it_fuzz_other"]]) {
    const url = new URL(value!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== `/${database}` || url.search || url.hash) throw new Error("fuzz requires its dedicated loopback databases");
  }
  const control = new Pool({ connectionString: controlUrl });
  const tenant = new Pool({ connectionString: tenantUrl });
  const otherTenant = new Pool({ connectionString: otherTenantUrl });
  let runtime: Pool;
  let otherRuntime: Pool;
  const runtimeFor = (tenantId: string) => tenantId === tenants[1] ? otherRuntime : runtime;
  let runtimeControl: Pool;
  const ticketIds = new Map<string, string>();
  const proposalIds = new Map<string, string>();
  const key = Buffer.alloc(32, 7).toString("base64");
  const usageInput = (tenantId: string, id = "canary") => ({ tenantId, metricId: "module.executions", quantity: 1, occurredAt: "2026-11-11T00:00:00.000Z", sourceReference: "synthetic", fingerprint: id, idempotencyKey: id });
  const admissionInput = (tenantId: string, id = "canary") => ({ scope: { tenantId, principalId: "user_fuzz", operation: "synthetic" }, idempotencyKey: id, fingerprint: id, sizeBytes: 1 });
  const capabilityInput = (tenantId: TenantId) => ({ tenantId, moduleKey: `fuzz-${String(tenantId).replaceAll("_", "-")}`, moduleVersion: "1.0.0", capability: "support.ticket.read", runtimePermissions: [`fuzz-${String(tenantId).replaceAll("_", "-")}.read`], identityBacked: true, actor, correlationId: "00000000-0000-4000-8000-000000000001" });
  beforeAll(async () => {
    console.info(`isolation fuzz seed=${seed}, runs=25 per family`);
    vi.stubEnv("CONTROL_PLANE_DATABASE_URL", controlUrl);
    vi.stubEnv("TENANT_DB_ENCRYPTION_KEY", key);
    vi.stubEnv("NEON_API_KEY", "synthetic"); vi.stubEnv("NEON_ORG_ID", "synthetic");
    await applyMigrations(control, await loadControlPlaneMigrations());
    vi.spyOn(NeonProvisioner.prototype, "findProjectByName").mockResolvedValue(null);
    vi.spyOn(NeonProvisioner.prototype, "createTenantProject")
      .mockResolvedValueOnce({ projectId: "synthetic_fuzz_a", connectionUri: tenantUrl, region: "aws-us-east-1" })
      .mockResolvedValueOnce({ projectId: "synthetic_fuzz_b", connectionUri: otherTenantUrl, region: "aws-us-east-1" });
    vi.spyOn(NeonProvisioner.prototype, "getConnectionUri").mockResolvedValue(tenantUrl);
    for (const [index, tenantId] of tenants.entries()) {
      await control.query("insert into tenants (tenant_id,slug,display_name,status,data_region) values ($1,$2,'Synthetic','provisioning','us')", [tenantId, `fuzz-${index}`]);
      await provisionTenantProject({ tenantId, tenantSlug: `fuzz-${index}`, dataRegion: "us" });
    }
    const stored = await control.query("select encrypted_connection from tenant_databases where tenant_id=$1", [tenants[1]]);
    const appUrl = new CredentialCipher(key).decrypt(stored.rows[0].encrypted_connection.toString("utf8"), tenants[1]!);
    // One disposable cluster shares login roles across databases. Use the latest
    // generated login for A's endpoint after provisioning B, which rotates that role.
    const runtimeUrl = new URL(appUrl); runtimeUrl.pathname = new URL(tenantUrl).pathname;
    runtime = new Pool({ connectionString: runtimeUrl.href, max: 1 });
    otherRuntime = new Pool({ connectionString: appUrl, max: 1 });
    const cpUrl = new URL(appUrl); cpUrl.pathname = new URL(controlUrl).pathname;
    runtimeControl = new Pool({ connectionString: cpUrl.href, max: 1 });
    await control.query("insert into platform_users (user_id,email) values ('user_fuzz','synthetic@example.test')");
    for (const tenantId of tenants) {
      const ticket = await withTenantContext(runtimeFor(tenantId), tenantId, client => createTicket(client, { tenantId, actor, createdBy: actor.userId, subject: `Canary ${tenantId}`, description: "Synthetic", category: "bug_report" }));
      ticketIds.set(tenantId, ticket.id);
      await control.query("insert into brand_policies (tenant_id, locked_keys) values ($1,'[]'::jsonb)", [tenantId]);
      const proposal = await new PgBrandProposalStore(control).upload({ tenantId, actor, fileDigest: "a".repeat(64), parserVersion: "brand-md-v1", uploadedAt: new Date(), values: { colorPrimary: "#123456" } });
      proposalIds.set(tenantId, proposal.proposalId);
      await new PgBrandProposalStore(control).review({ tenantId, proposalId: proposal.proposalId, actor, reason: "Synthetic review" });
      await new PgTenantVoiceProfileStore(control).publish({ tenantId, profile, expectedRevision: 0, actor, reason: "Synthetic canary" });
      await new PgUsageLedger(control, metrics).append(usageInput(tenantId));
      expect(await new PgAdmissionStore(control).admit(admissionInput(tenantId), policy)).toMatchObject({ admitted: true });
      const authority = { kind: "installation_owner" as const, userId: "user_fuzz" as import("@opentenant/auth").UserId, permissions: ["owner.support.module_grant.manage"] as const, source: "legacy_platform_admin" as const };
      const capabilities = new PgModuleCapabilityStore(control);
      expect(await capabilities.grantModuleCreatorCapability({ tenantId, creatorUserId: actor.userId, capability: "support.ticket.read", expiresAt: null, authority })).toEqual({ allowed: true });
      const moduleKey = `fuzz-${String(tenantId).replaceAll("_", "-")}`;
      const ownership = new PgModuleOwnershipStore(control);
      await ownership.createTenantPrivate({ moduleKey, version: "1.0.0", runtime: "native", tenantId, artifactDigest: "b".repeat(64), remoteUrl: null, createdByUserId: actor.userId, capabilityRequests: [{ capability: "support.ticket.read", runtimePermission: `${moduleKey}.read` }] });
      expect(await ownership.assignToTenant({ moduleKey, version: "1.0.0", tenantId, enabled: true, settings: {}, actor })).toBe(true);
      expect(await capabilities.grantTenantCapability({ tenantId, moduleKey, moduleVersion: "1.0.0", capability: "support.ticket.read", expiresAt: null, authority })).toEqual({ allowed: true });

    }
  }, 60_000);
  afterAll(async () => {
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    await runtime?.end(); await otherRuntime?.end(); await runtimeControl?.end(); await tenant.end(); await otherTenant.end(); await control.end();
    const shared = globalThis as typeof globalThis & { [key: symbol]: Pool | undefined };
    await shared[Symbol.for("opentenant.control-plane-pool")]?.end();
    delete shared[Symbol.for("opentenant.control-plane-pool")];
  });

  async function snapshot(family: Family, tenantId: string) {
    const pool = family === "support" ? (tenantId === tenants[1] ? otherTenant : tenant) : control;
    const scopedTables = family === "support" || family === "audit" ? tables[family] : [...tables[family], "audit_events"];
    return Promise.all(scopedTables.map(async table => (await pool.query(`select to_jsonb(t) as row from ${table} t where tenant_id=$1 order by to_jsonb(t)::text`, [tenantId])).rows));
  }
  async function rejected(operation: () => Promise<unknown>) {
    const outcome = await operation().then(value => ({ value }), error => ({ error }));
    expect(outcome).toHaveProperty("error");
    // A real PostgreSQL ACL/RLS denial, rather than an accidentally broken call.
    const error = (outcome as { error: { code?: string; constructor: { name: string } } }).error;
    if (error.constructor.name === "UsageLedgerValidationError") return;
    expect(error.code).toBe("42501");
  }
  async function storeAttack(family: Family, context: TenantId, inputId: TenantId, op: number, id: string) {
    if (family === "support") {
      await withTenantContext(runtimeFor(inputId), context, async client => {
        if (op === 0) expect(await getTicket(client, inputId, ticketIds.get(inputId) ?? ticketIds.get(tenants[1]!)!)).toBeNull();
        if (op === 1) await expect(setStatus(client, { tenantId: inputId, ticketId: ticketIds.get(inputId) ?? ticketIds.get(tenants[1]!)!, actor, status: "closed" })).rejects.toThrow("ticket not found");
        if (op === 2) await rejected(() => client.query("delete from support.tickets where tenant_id=$1", [inputId]));
        if (op === 3) await rejected(() => createTicket(client, { tenantId: inputId, actor, createdBy: actor.userId, subject: "Attack", description: "Synthetic", category: "bug_report" }));
      }).catch(error => { if (op !== 2 && op !== 3) throw error; expect(error.code).toBe("25P02"); });
      return;
    }
    // tenant_app is never granted control-plane privileges by production provisioning.
    const client = await runtimeControl.connect();
    try {
      await client.query("select set_config('app.tenant_id',$1,false)", [context]);
      const pool = { query: client.query.bind(client), connect: async () => new Proxy(client, { get(target, key) { return key === "release" ? () => {} : Reflect.get(target, key); } }) } as unknown as Pool;
      if (family === "brand") await rejected(() => op % 2 === 0 ? new PgBrandProposalStore(pool).preview(proposalIds.get(tenants[1]!)!, inputId) : new PgBrandProposalStore(pool).revoke({ tenantId: inputId, proposalId: proposalIds.get(tenants[1]!)!, actor, reason: "Attack" }));
      if (family === "voice") await rejected(() => op % 2 === 0 ? new PgTenantVoiceProfileStore(pool).getCurrent(inputId) : new PgTenantVoiceProfileStore(pool).revoke({ tenantId: inputId, version: 1, expectedRevision: 1, actor, reason: "Attack" }));
      if (family === "audit") await rejected(() => op % 2 === 0 ? new PgAuditStore(pool).listForTenant(inputId, 10) : new PgAuditStore(pool).append({ tenantId: inputId, occurredAt: new Date(), actor, action: "fuzz.attack", subject: "synthetic", detail: {} }));
      if (family === "usage") await rejected(() => op % 2 === 0 ? new PgUsageLedger(pool, metrics).aggregate({ tenantId: inputId, metricId: "module.executions", start: "2026-11-11T00:00:00.000Z", end: "2026-11-12T00:00:00.000Z" }) : new PgUsageLedger(pool, metrics).append(usageInput(inputId, id)));
      if (family === "admission") expect(await new PgAdmissionStore(pool).admit(admissionInput(inputId, id), policy)).toEqual({ admitted: false, code: "invalid_request" });
      if (family === "capabilities") await rejected(() => new PgModuleCapabilityStore(pool).withAuthorizedCapability(capabilityInput(inputId), async () => { throw new Error("must never execute capability"); }));
      await client.query("rollback");
      // Raw update/delete attempts also must fail even for stores with no delete API.
      await rejected(() => client.query(`${op % 2 === 0 ? "delete from" : "update"} ${tables[family][0]} ${op % 2 === 0 ? "" : "set tenant_id=tenant_id"} where tenant_id=$1`, [inputId]));
    } finally {
      await client.query("rollback"); await client.query("reset app.tenant_id"); client.release();
    }
  }

  async function trustedStoreOperation(family: Family, context: TenantId, other: TenantId, op: number, id: string) {
    if (family === "support") {
      await withTenantContext(runtimeFor(context), context, async client => {
        expect((await getTicket(client, context, ticketIds.get(context)!))?.ticket.tenantId).toBe(context);
        if (op % 2) await setStatus(client, { tenantId: context, ticketId: ticketIds.get(context)!, actor, status: "open" });
      });
    }
    if (family === "brand") {
      const store = new PgBrandProposalStore(control);
      expect(await store.preview(proposalIds.get(context)!, context)).toBeDefined();
      await expect(store.revoke({ tenantId: context, proposalId: proposalIds.get(other)!, actor, reason: "Cross-tenant resource" })).rejects.toThrow();
    }
    if (family === "voice") {
      const store = new PgTenantVoiceProfileStore(control);
      expect((await store.listHistory(context)).every(row => row.tenantId === context)).toBe(true);
      if (op % 2) {
        const head = await store.getCurrent(context);
        const word = "word" + [...id].map(char => String.fromCharCode(97 + char.charCodeAt(0) % 26)).join("");
        if (head!.current?.profile.preferredWords[0] !== word) await store.publish({ tenantId: context, profile: { ...profile, preferredWords: [word] }, expectedRevision: head!.revision, actor, reason: "Synthetic sequence" });
      }
    }
    if (family === "audit") {
      const store = new PgAuditStore(control);
      await store.append({ tenantId: context, occurredAt: new Date(), actor, action: "fuzz.sequence", subject: id, detail: {} });
      expect((await store.listForTenant(context, 10)).every(row => row.tenantId === context)).toBe(true);
    }
    if (family === "usage") {
      const event = await new PgUsageLedger(control, metrics).append(usageInput(context, id));
      expect(event.tenantId).toBe(context);
    }
    if (family === "admission") {
      const store = new PgAdmissionStore(control);
      const result = await store.admit(admissionInput(context, id), policy);
      expect(result).toMatchObject({ admitted: true });
      if (result.admitted) await store.release({ scope: admissionInput(context).scope, leaseId: result.lease.leaseId });
    }
    if (family === "capabilities") {
      const store = new PgModuleCapabilityStore(control);
      let called = false;
      expect(await store.withAuthorizedCapability(capabilityInput(context), async () => ({ value: context, resultCount: 1, resultSize: "one" }))).toEqual({ allowed: true, value: context });
      expect(await store.withAuthorizedCapability({ ...capabilityInput(other), tenantId: context }, async () => { called = true; return { value: other, resultCount: 1, resultSize: "one" }; })).toMatchObject({ allowed: false });
      expect(called).toBe(false);
    }
  }

  it("uses production provisioning and a non-owner runtime role", async () => {
    expect((await runtime.query("select rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    expect((await control.query("select count(*)::int as n from tenant_databases where tenant_id=any($1)", [tenants])).rows[0].n).toBe(2);
    for (const tenantId of tenants) {
      await withTenantContext(runtimeFor(tenantId), tenantId, async client => expect(await getTicket(client, tenantId, ticketIds.get(tenantId)!)).not.toBeNull());
      expect((await new PgTenantVoiceProfileStore(control).getCurrent(tenantId))?.current).not.toBeNull();
      expect(await new PgUsageLedger(control, metrics).aggregate({ tenantId, metricId: "module.executions", start: "2026-11-11T00:00:00.000Z", end: "2026-11-12T00:00:00.000Z" })).toBe(1);
    }
  });
  it.each(families)("fuzzes %s sequences without observing or changing another tenant", async family => {
    await fc.assert(fc.asyncProperty(fc.array(fc.record({ reverse: fc.boolean(), op: fc.integer({ min: 0, max: 3 }), id: fc.uuid() }), { minLength: 4, maxLength: 8 }), async operations => {
      const schedule = [...[0, 1, 2, 3].map(op => ({ reverse: false, op, id: `required-${family}-${op}` })), ...operations];
      for (const { reverse, op, id } of schedule) {
        const context = tenants[reverse ? 1 : 0]!;
        const other = tenants[reverse ? 0 : 1]!;
        const before = await snapshot(family, other);
        await trustedStoreOperation(family, context, other, op, id);
        await storeAttack(family, context, other, op, id);
        expect(await snapshot(family, other)).toEqual(before);
      }
    }), { seed, numRuns: 25, verbose: false });
  }, 240_000);
  it("fails closed for null, empty, mismatched, look-alike and SQL tenant IDs", async () => {
    const invalid = [null, "", "tenant_fuzz_а", "tenant_missing", "' OR 1=1; DROP TABLE tenants; --"];
    await fc.assert(fc.asyncProperty(fc.shuffledSubarray(invalid, { minLength: invalid.length, maxLength: invalid.length }), async ids => {
      for (const value of ids) {
        await withTenantContext(runtime, tenants[0]!, async client => {
          expect(await getTicket(client, value as TenantId, ticketIds.get(tenants[1]!)!)).toBeNull();
          await rejected(() => createTicket(client, { tenantId: value as TenantId, actor, createdBy: actor.userId, subject: "Attack", description: "Synthetic", category: "bug_report" }));
        });
        await withTenantContext(runtime, value as TenantId, async client => {
          expect((await client.query("select * from support.tickets")).rows).toEqual([]);
          await rejected(() => createTicket(client, { tenantId: tenants[0]!, actor, createdBy: actor.userId, subject: "Attack", description: "Synthetic", category: "bug_report" }));
        }).catch(error => { expect(error.code).toBe("25P02"); });
        for (const family of families.filter(f => f !== "support")) {
          const before = await snapshot(family, tenants[1]!);
          for (const op of [0, 1, 2, 3]) await storeAttack(family, tenants[0]!, value as TenantId, op, "invalid");
          expect(await snapshot(family, tenants[1]!)).toEqual(before);
        }
      }
    }), { seed, numRuns: 5, verbose: false });
  }, 240_000);
});
