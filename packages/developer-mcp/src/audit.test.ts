import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  DEVELOPER_MCP_AUDIT_FIELDS,
  assertDeveloperMcpAuditRecord,
  computeDeveloperMcpAuditDigest,
  createInMemoryDeveloperMcpAuditAppendAdapter,
  type DeveloperMcpAuditRecord,
  type UncommittedDeveloperMcpAuditRecord,
} from "./index";

const uncommitted = (correlationId = "00000000-0000-4000-8000-000000000001"): UncommittedDeveloperMcpAuditRecord =>
  assertDeveloperMcpAuditRecord({
    toolName: null, schemaVersion: "2", slug: null, profileVersion: null, clientId: null,
    userId: null, tenantId: null, resourceType: null, resourceId: null, riskClass: null,
    authorizationDecision: "deny", revocationCheckResult: "not_required", outcome: "denied",
    correlationId, priorDigest: null, currentDigest: null, contextResolution: "unresolved",
    decisionCode: "invalid_context",
  }) as UncommittedDeveloperMcpAuditRecord;

const literalPreimage = "[[\"toolName\",null],[\"schemaVersion\",\"2\"],[\"slug\",null],[\"profileVersion\",null],[\"clientId\",null],[\"userId\",null],[\"tenantId\",null],[\"resourceType\",null],[\"resourceId\",null],[\"riskClass\",null],[\"authorizationDecision\",\"deny\"],[\"revocationCheckResult\",\"not_required\"],[\"outcome\",\"denied\"],[\"correlationId\",\"00000000-0000-4000-8000-000000000001\"],[\"priorDigest\",\"genesis\"],[\"contextResolution\",\"unresolved\"],[\"decisionCode\",\"invalid_context\"]]";
const literalDigest = "sha256:4a244aeb6bffa200e19bf970ff06dff0b12148d8e7676428ef6006d3f966a3cf";

describe("Developer MCP audit append", () => {
  it("pins the literal digest preimage and independently computed oracle", async () => {
    expect(createHash("sha256").update(literalPreimage, "utf8").digest("hex"))
      .toBe(literalDigest.slice("sha256:".length));
    const record = assertDeveloperMcpAuditRecord({ ...uncommitted(), priorDigest: "genesis" });
    expect(computeDeveloperMcpAuditDigest(record)).toBe(literalDigest);
    const adapter = createInMemoryDeveloperMcpAuditAppendAdapter();
    await adapter.append(uncommitted());
    expect(adapter.records[0]!.currentDigest).toBe(literalDigest);
  });

  it("commits a serialized chain and resolves with the exact frozen stored record", async () => {
    const adapter = createInMemoryDeveloperMcpAuditAppendAdapter();
    const returned = [];
    for (let index = 1; index <= 3; index += 1) {
      returned.push(await adapter.append(uncommitted(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`)));
    }
    expect(adapter.records).toHaveLength(3);
    expect(adapter.records[0]!.priorDigest).toBe("genesis");
    expect(adapter.records[1]!.priorDigest).toBe(adapter.records[0]!.currentDigest);
    expect(adapter.records[2]!.priorDigest).toBe(adapter.records[1]!.currentDigest);
    returned.forEach((record, index) => {
      expect(record).toBe(adapter.records[index]);
      expect(Object.isFrozen(record)).toBe(true);
      expect(assertDeveloperMcpAuditRecord(record)).toEqual(record);
      expect(record.currentDigest).toBe(computeDeveloperMcpAuditDigest(record));
    });
    expect(Object.isFrozen(adapter.records)).toBe(true);
  });

  it("rejects invalid input before commit and leaves records unchanged", async () => {
    const adapter = createInMemoryDeveloperMcpAuditAppendAdapter();
    await expect(adapter.append({ ...uncommitted(), priorDigest: "genesis" } as never)).rejects.toThrow(TypeError);
    expect(adapter.records).toEqual([]);
  });

  it("covers every digest-preimage field and excludes currentDigest", async () => {
    const adapter = createInMemoryDeveloperMcpAuditAppendAdapter();
    const stored = await adapter.append(uncommitted());
    const preimageNames = JSON.parse(literalPreimage).map(([name]: [string, unknown]) => name);
    expect(preimageNames).toEqual(DEVELOPER_MCP_AUDIT_FIELDS.filter((field) => field !== "currentDigest"));
    for (const field of DEVELOPER_MCP_AUDIT_FIELDS) {
      if (field === "currentDigest") continue;
      if (field === "correlationId") {
        const changed = assertDeveloperMcpAuditRecord({ ...stored, correlationId: "00000000-0000-4000-8000-000000000002", currentDigest: null });
        expect(computeDeveloperMcpAuditDigest(changed)).not.toBe(stored.currentDigest);
      } else if (field === "priorDigest") {
        const changed = assertDeveloperMcpAuditRecord({ ...stored, priorDigest: `sha256:${"0".repeat(64)}`, currentDigest: null });
        expect(computeDeveloperMcpAuditDigest(changed)).not.toBe(stored.currentDigest);
      } else {
        expect(literalPreimage).toContain(`["${field}",`);
      }
    }
    expect(computeDeveloperMcpAuditDigest({ ...stored, currentDigest: null } as DeveloperMcpAuditRecord)).toBe(stored.currentDigest);
    expect(computeDeveloperMcpAuditDigest({ ...stored, currentDigest: "sha256:" + "f".repeat(64) } as DeveloperMcpAuditRecord)).toBe(stored.currentDigest);
  });
});
