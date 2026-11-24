import { describe, expect, it } from "vitest";
import { parseBrandTokenInput, parseBrandTokenValue } from "./brand-validation";

describe("brand token input parsing", () => {
  it.each([
    ["displayName", "true"],
    ["cssBrandKey", "2026"],
    ["reportLabel", "false"],
    ["exportFilenameSuffix", "2026"],
  ] as const)("keeps text token %s as text even when it resembles JSON", (key, value) => {
    expect(parseBrandTokenInput(key, value)).toEqual({ ok: true, value });
  });

  it("continues to parse structured and boolean token values", () => {
    expect(parseBrandTokenInput("coBrandingRequired", "true")).toEqual({
      ok: true,
      value: true,
    });
    expect(parseBrandTokenInput(
      "legalLinks",
      '[{"label":"Privacy","url":"https://www.example.test/privacy"}]',
    )).toEqual({
      ok: true,
      value: [{
        label: "Privacy",
        url: "https://www.example.test/privacy",
      }],
    });
  });

  it("keeps immutable brand document v1 JSON-coercion semantics unchanged", () => {
    expect(parseBrandTokenValue("reportLabel", "2026")).toEqual({
      ok: false,
      reason: "reportLabel must be text",
    });
    expect(parseBrandTokenValue("displayName", '"Acme"')).toEqual({
      ok: true,
      value: "Acme",
    });
    expect(parseBrandTokenInput("displayName", '"Acme"')).toEqual({
      ok: true,
      value: '"Acme"',
    });
  });
});
