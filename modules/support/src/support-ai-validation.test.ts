import { describe, expect, it } from "vitest";
import { validSupportDraft, validSupportAbstention } from "./support-ai-validation";
const body = "You are not eligible after 30 days.";
const citation = { chunkId: "article:body", start: 0, end: body.length };
const knowledge = [{ chunkId: citation.chunkId, articleId: "article", body, provenance: [] }];
const draft = { kind: "draft", category: "how_to", priority: "medium", reply: body, confidence: 0.9, claims: [{ text: body, citation }] };
describe("untrusted support adapter output", () => {
  it("keeps exact whole sentences and rejects negation truncation", () => {
    expect(validSupportDraft(draft, knowledge)).toBe(true);
    expect(validSupportDraft({ ...draft, reply: "eligible after 30 days.", claims: [{ text: "eligible after 30 days.", citation: { ...citation, start: 12 } }] }, knowledge)).toBe(false);
  });
  it.each([null, [], {}, { ...draft, confidence: NaN }, { ...draft, send: true }, { ...draft, category: "invented" }, { ...draft, claims: [{ text: body, citation: { ...citation, tenantId: "other" } }] }])("rejects malformed output without throwing", value => {
    expect(validSupportDraft(value, knowledge)).toBe(false);
  });
  it("compares citation fields independently of JSON key order",()=>{
    expect(validSupportDraft({...draft,segments:[{kind:"claim",text:body,citation:{end:body.length,start:0,chunkId:citation.chunkId}}]},knowledge)).toBe(true);
    expect(validSupportAbstention({kind:"abstain",reason:"PRIVATE_PROVIDER_TEXT"})).toBe(false);
  });
  it("rejects mismatched segment citations and banned words", () => {
    expect(validSupportDraft({ ...draft, segments: [{ kind: "claim", text: body, citation: { ...citation, chunkId: "other" } }] }, knowledge)).toBe(false);
    expect(validSupportDraft(draft, knowledge, ["eligible"])).toBe(false);
    expect(validSupportDraft({ ...draft, segments: [{ kind: "unknown", text: body }] }, knowledge)).toBe(false);
  });
});
