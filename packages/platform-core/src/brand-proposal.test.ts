import { describe, expect, it } from "vitest";
import type { TenantId } from "@opentenant/auth";
import {
  applyBrandProposal,
  createBrandProposal,
  discardBrandProposal,
  editBrandProposal,
  reviewBrandProposal,
  supersedeBrandProposal,
} from "./brand-proposal";

const tenantId = "ten_brand_proposal" as TenantId;
const retrievedAt = new Date("2026-07-22T08:00:00.000Z");

describe("brand proposals", () => {
  it("starts inactive and keeps provenance beside every proposed value", () => {
    const proposal = createBrandProposal({
      proposalId: "brp_example",
      tenantId,
      sourceOrigin: "https",
      values: {
        displayName: {
          value: "Example Organisation",
          provenance: {
            kind: "https",
            sourceUrl: "https://www.example.test/about",
            retrievedAt,
          },
        },
      },
      parserVersion: null,
      createdAt: retrievedAt,
    });

    expect(proposal.status).toBe("draft");
    expect(proposal.values.displayName?.provenance).toEqual({
      kind: "https",
      sourceUrl: "https://www.example.test/about",
      retrievedAt,
    });
    expect(proposal.values.displayName?.value).toBe("Example Organisation");
  });

  it("accepts upload provenance without a source URL", () => {
    const proposal = createBrandProposal({
      proposalId: "brp_upload",
      tenantId,
      sourceOrigin: "upload",
      values: {
        displayName: {
          value: "Example Organisation",
          provenance: {
            kind: "upload",
            fileDigest: "a".repeat(64),
            uploadedByUserId: "usr_admin_1",
            uploadedAt: retrievedAt,
          },
        },
      },
      parserVersion: "brand-md-v1",
      createdAt: retrievedAt,
    });

    expect(proposal.values.displayName?.provenance.kind).toBe("upload");
    expect(proposal.parserVersion).toBe("brand-md-v1");
  });

  it("requires uploads to name their parser and non-uploads to name no parser", () => {
    const uploadValues = {
      displayName: {
        value: "Example Organisation",
        provenance: {
          kind: "upload" as const,
          fileDigest: "a".repeat(64),
          uploadedByUserId: "usr_admin_1",
          uploadedAt: retrievedAt,
        },
      },
    };
    expect(() => createBrandProposal({
      proposalId: "brp_upload_without_parser",
      tenantId,
      sourceOrigin: "upload",
      values: uploadValues,
      parserVersion: null,
      createdAt: retrievedAt,
    })).toThrow("Upload brand proposals require a parser version");

    expect(() => createBrandProposal({
      proposalId: "brp_https_with_parser",
      tenantId,
      sourceOrigin: "https",
      values: {
        displayName: {
          value: "Example Organisation",
          provenance: {
            kind: "https",
            sourceUrl: "https://www.example.test/about",
            retrievedAt,
          },
        },
      },
      parserVersion: "brand-md-v1",
      createdAt: retrievedAt,
    })).toThrow("Non-upload brand proposals require no parser version");

    expect(createBrandProposal({
      proposalId: "brp_empty_upload",
      tenantId,
      sourceOrigin: "upload",
      values: {},
      parserVersion: "brand-md-v1",
      createdAt: retrievedAt,
    }).parserVersion).toBe("brand-md-v1");

    expect(() => createBrandProposal({
      proposalId: "brp_origin_mismatch",
      tenantId,
      sourceOrigin: "https",
      values: uploadValues,
      parserVersion: null,
      createdAt: retrievedAt,
    })).toThrow("must match its source origin");
  });

  it("is reviewable without becoming active and can be safely discarded", () => {
    const proposal = createBrandProposal({
      proposalId: "brp_example",
      tenantId,
      sourceOrigin: "https",
      values: {
        displayName: {
          value: "Example Organisation",
          provenance: {
            kind: "https",
            sourceUrl: "https://www.example.test/about",
            retrievedAt,
          },
        },
      },
      parserVersion: null,
      createdAt: retrievedAt,
    });

    const reviewed = reviewBrandProposal(proposal, retrievedAt, 7);
    expect(reviewed.status).toBe("reviewed");
    expect(discardBrandProposal(reviewed, retrievedAt).status).toBe("discarded");
  });

  it("can supersede a draft and apply a reviewed proposal", () => {
    const draft = createBrandProposal({
      proposalId: "brp_supersede",
      tenantId,
      sourceOrigin: "upload",
      values: {
        displayName: {
          value: "Example Organisation",
          provenance: {
            kind: "upload",
            fileDigest: "b".repeat(64),
            uploadedByUserId: "usr_admin_1",
            uploadedAt: retrievedAt,
          },
        },
      },
      parserVersion: "brand-md-v1",
      createdAt: retrievedAt,
    });
    expect(supersedeBrandProposal(draft, retrievedAt).status).toBe("superseded");

    const reviewed = reviewBrandProposal(draft, retrievedAt, 4);
    const applied = applyBrandProposal(reviewed, retrievedAt);
    expect(applied.status).toBe("applied");
    expect(applied.reviewedPolicyVersion).toBe(4);
  });

  it("edits values without changing provenance and invalidates prior review", () => {
    const draft = createBrandProposal({
      proposalId: "brp_edit",
      tenantId,
      sourceOrigin: "upload",
      values: {
        displayName: {
          value: "Before",
          provenance: {
            kind: "upload",
            fileDigest: "c".repeat(64),
            uploadedByUserId: "usr_admin_1",
            uploadedAt: retrievedAt,
          },
        },
      },
      parserVersion: "brand-md-v1",
      createdAt: retrievedAt,
    });
    const reviewed = reviewBrandProposal(draft, retrievedAt, 4);

    const edited = editBrandProposal(reviewed, { displayName: "After" });

    expect(edited).toMatchObject({
      proposalId: "brp_edit",
      sourceOrigin: "upload",
      parserVersion: "brand-md-v1",
      status: "draft",
      reviewedAt: null,
      reviewedPolicyVersion: null,
    });
    expect(edited.values.displayName).toEqual({
      value: "After",
      provenance: draft.values.displayName!.provenance,
    });
  });

  it.each(["applied", "discarded", "superseded"] as const)("refuses to edit a %s proposal", (status) => {
    const proposal = {
      ...createBrandProposal({
        proposalId: "brp_terminal",
        tenantId,
        sourceOrigin: "https" as const,
        values: {},
        parserVersion: null,
        createdAt: retrievedAt,
      }),
      status,
    };
    expect(() => editBrandProposal(proposal, {})).toThrow("immutable");
  });

  it("rejects empty and normalized no-op edits", () => {
    const proposal = createBrandProposal({
      proposalId: "brp_noop",
      tenantId,
      sourceOrigin: "https",
      values: {
        displayName: {
          value: "Example Organisation",
          provenance: {
            kind: "https",
            sourceUrl: "https://www.example.test/about",
            retrievedAt,
          },
        },
        legalLinks: {
          value: [{
            url: "https://www.example.test/privacy",
            label: "Privacy",
          }],
          provenance: {
            kind: "https",
            sourceUrl: "https://www.example.test/about",
            retrievedAt,
          },
        },
      },
      parserVersion: null,
      createdAt: retrievedAt,
    });

    expect(() => editBrandProposal(proposal, {})).toThrow("changed values");
    expect(() => editBrandProposal(proposal, {
      displayName: "  Example Organisation  ",
    })).toThrow("changed values");
    expect(() => editBrandProposal(proposal, {
      legalLinks: [{
        label: "Privacy",
        url: "https://www.example.test/privacy",
      }],
    })).toThrow("changed values");
  });

  it("rejects empty reviews and incoherent transition timestamps", () => {
    const empty = createBrandProposal({
      proposalId: "brp_empty",
      tenantId,
      sourceOrigin: "https",
      values: {},
      parserVersion: null,
      createdAt: retrievedAt,
    });
    expect(() => reviewBrandProposal(empty, retrievedAt, 1)).toThrow("populated brand proposals");

    const populated = createBrandProposal({
      proposalId: "brp_populated",
      tenantId,
      sourceOrigin: "https",
      values: {
        displayName: {
          value: "Example Organisation",
          provenance: {
            kind: "https",
            sourceUrl: "https://www.example.test/about",
            retrievedAt,
          },
        },
      },
      parserVersion: null,
      createdAt: retrievedAt,
    });
    const beforeCreation = new Date("2026-07-22T07:59:59.000Z");
    expect(() => reviewBrandProposal(populated, beforeCreation, 1)).toThrow("valid transition time");
    const reviewed = reviewBrandProposal(populated, retrievedAt, 1);
    expect(() => discardBrandProposal(reviewed, beforeCreation)).toThrow("valid transition time");
  });

  it("rejects values without valid provenance", () => {
    expect(() => createBrandProposal({
      proposalId: "brp_example",
      tenantId,
      sourceOrigin: "https",
      values: {
        displayName: {
          value: "Example Organisation",
          provenance: {
            kind: "https",
            sourceUrl: "http://127.0.0.1/private",
            retrievedAt,
          },
        },
      },
      parserVersion: null,
      createdAt: retrievedAt,
    })).toThrow("valid provenance");
    expect(() => createBrandProposal({
      proposalId: "brp_example",
      tenantId,
      sourceOrigin: "upload",
      values: {
        displayName: {
          value: "Example Organisation",
          provenance: { kind: "upload", fileDigest: "bad", uploadedByUserId: "u", uploadedAt: retrievedAt } as never,
        },
      },
      parserVersion: "brand-md-v1",
      createdAt: retrievedAt,
    })).toThrow("valid provenance");
  });
});
