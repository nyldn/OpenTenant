import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("tenant voice-profile Unicode tables", () => {
  it("keeps the frozen SQL mark multirange aligned with the running Node Unicode table", async () => {
    const sql = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), "..", "sql", "control-plane", "0024_tenant_voice_profiles.sql"),
      "utf8",
    );
    const literal = sql.match(/select codepoint <@ '\{([\s\S]*?)\}'::int4multirange/)?.[1];
    expect(literal).toBeDefined();

    const ranges = [...literal!.matchAll(/\[(\d+),(\d+)\)/g)]
      .map((match) => [Number(match[1]), Number(match[2])] as const);
    expect(ranges.length).toBeGreaterThan(300);
    expect(literal!.replace(/\s|,|\[\d+,\d+\)/g, "")).toBe("");

    let rangeIndex = 0;
    let mismatch: number | null = null;
    for (let codepoint = 0; codepoint <= 0x10FFFF; codepoint += 1) {
      while (ranges[rangeIndex] && codepoint >= ranges[rangeIndex]![1]) rangeIndex += 1;
      const isFrozenMark = Boolean(
        ranges[rangeIndex]
        && codepoint >= ranges[rangeIndex]![0]
        && codepoint < ranges[rangeIndex]![1],
      );
      const isNodeMark = /\p{M}/u.test(String.fromCodePoint(codepoint));
      if (isFrozenMark !== isNodeMark) {
        mismatch = codepoint;
        break;
      }
    }
    expect(mismatch === null ? null : `U+${mismatch.toString(16).toUpperCase()}`).toBeNull();
  }, 30_000);

  it("keeps the SQL unsafe-codepoint table aligned with Node for PostgreSQL text", async () => {
    const sql = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), "..", "sql", "control-plane", "0024_tenant_voice_profiles.sql"),
      "utf8",
    );
    const body = sql.match(
      /create function tenant_voice_profile_text_is_safe[\s\S]*?as \$\$([\s\S]*?)\$\$;/,
    )?.[1];
    expect(body).toBeDefined();

    const blocked = new Set<number>();
    for (const match of body!.matchAll(/codepoint between (\d+) and (\d+)/g)) {
      for (let codepoint = Number(match[1]); codepoint <= Number(match[2]); codepoint += 1) {
        blocked.add(codepoint);
      }
    }
    for (const match of body!.matchAll(/codepoint = (\d+)/g)) blocked.add(Number(match[1]));
    for (const match of body!.matchAll(/codepoint in \(([\d,\s]+)\)/g)) {
      for (const value of match[1]!.split(",")) blocked.add(Number(value.trim()));
    }

    let mismatch: number | null = null;
    for (let codepoint = 0; codepoint <= 0x10FFFF; codepoint += 1) {
      if (codepoint >= 0xD800 && codepoint <= 0xDFFF) continue;
      const isNodeUnsafe = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(String.fromCodePoint(codepoint));
      if (blocked.has(codepoint) !== isNodeUnsafe) {
        mismatch = codepoint;
        break;
      }
    }
    expect(mismatch === null ? null : `U+${mismatch.toString(16).toUpperCase()}`).toBeNull();
  }, 30_000);
});
