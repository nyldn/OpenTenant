import { describe, expect, it } from "vitest";
import {
  SUPPORT_SCAFFOLD,
  SUPPORT_SCAFFOLD_VERSION,
  isScaffoldId,
  renderSegments,
  validateComposition,
  type ReplySegment,
} from "./reply-scaffold";

const claim = (text: string): ReplySegment => ({
  kind: "claim",
  text,
  citation: { chunkId: "c1", start: 0, end: text.length },
});

const REFUND = "Refunds are issued within five days.";

describe("the scaffold table", () => {
  it("is versioned and frozen", () => {
    expect(SUPPORT_SCAFFOLD_VERSION).toBe("support-scaffold-v1");
    expect(Object.isFrozen(SUPPORT_SCAFFOLD)).toBe(true);
  });

  it("contains no URL, address, or contact route", () => {
    for (const [id, phrase] of Object.entries(SUPPORT_SCAFFOLD)) {
      expect(phrase, id).not.toMatch(/https?:\/\/|www\.|@|\+\d/u);
    }
  });

  it("contains no addressee placeholder, because the boundary refuses the requester name", () => {
    for (const [id, phrase] of Object.entries(SUPPORT_SCAFFOLD)) {
      expect(phrase, id).not.toMatch(/\{|\}|\$|<[a-z]/iu);
    }
  });

  it("makes no commitment and states no policy", () => {
    // A phrase that would be false in some other ticket is a claim, not
    // scaffold. These are the words that betray one.
    for (const [id, phrase] of Object.entries(SUPPORT_SCAFFOLD)) {
      expect(phrase, id).not.toMatch(/\bwe will\b|\bguarantee|\brefund|\beligible|\bwithin \d/iu);
    }
  });
});

describe("composition", () => {
  const segments: ReplySegment[] = [
    { kind: "scaffold", id: "greeting_plain" },
    { kind: "scaffold", id: "ack_received" },
    claim(REFUND),
    { kind: "scaffold", id: "closing_help" },
    { kind: "scaffold", id: "signoff_plain" },
    { kind: "scaffold", id: "signoff_team" },
  ];
  const rendered = renderSegments(segments);

  it("renders a readable reply from a cited sentence and scaffold", () => {
    expect(rendered).toBe(
      "Hello, Thanks for getting in touch. Refunds are issued within five days. I hope that helps. Best, Support",
    );
    expect(validateComposition(segments, rendered)).toEqual([]);
  });

  it("refuses a scaffold id that is not in the table", () => {
    const forged = [
      { kind: "scaffold", id: "greeting_warm" },
      claim(REFUND),
    ] as unknown as ReplySegment[];
    const problems = validateComposition(forged, renderSegments(forged));
    expect(problems.map((problem) => problem.reason).join(" ")).toMatch(/unknown scaffold id/);
  });

  it("refuses a reply whose text does not match its segments", () => {
    // The model describing one reply and sending another is the failure this
    // check exists for.
    const problems = validateComposition(segments, `${rendered} We will waive your fee.`);
    expect(problems.map((problem) => problem.reason).join(" ")).toMatch(/does not match its segments/);
  });

  it("refuses a reply made only of scaffold", () => {
    const empty: ReplySegment[] = [
      { kind: "scaffold", id: "greeting_plain" },
      { kind: "scaffold", id: "closing_help" },
    ];
    const problems = validateComposition(empty, renderSegments(empty));
    expect(problems.map((problem) => problem.reason).join(" ")).toMatch(/no cited claim/);
  });

  it("refuses an empty segment list and a blank claim", () => {
    expect(validateComposition([], "")).toHaveLength(1);
    const blank = [{ kind: "claim", text: "  ", citation: { chunkId: "c1", start: 0, end: 1 } }] as ReplySegment[];
    expect(validateComposition(blank, renderSegments(blank)).length).toBeGreaterThan(0);
  });

  it("cannot express invented prose, because a segment is an id or a citation", () => {
    // There is no segment shape that carries free text the model authored.
    const shapes = segments.map((segment) => segment.kind);
    expect(new Set(shapes)).toEqual(new Set(["claim", "scaffold"]));
    expect(isScaffoldId("greeting_plain")).toBe(true);
    expect(isScaffoldId("anything_else")).toBe(false);
  });
});
