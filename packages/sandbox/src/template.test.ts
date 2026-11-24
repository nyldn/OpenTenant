import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { digestTemplateFiles, SYNTHETIC_MODULE_TEMPLATE } from "./template";

describe("synthetic module template", () => {
  it("has an immutable, content-addressed identity", () => {
    expect(Object.isFrozen(SYNTHETIC_MODULE_TEMPLATE)).toBe(true);
    expect(Object.isFrozen(SYNTHETIC_MODULE_TEMPLATE.ref)).toBe(true);
    expect(SYNTHETIC_MODULE_TEMPLATE.ref.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("returns fresh file bytes so callers cannot mutate the approved template", () => {
    const first = SYNTHETIC_MODULE_TEMPLATE.files();
    const originalDigest = createHash("sha256").update(first[0]!.contents).digest("hex");
    first[0]!.contents[0] = 0;
    const secondDigest = createHash("sha256")
      .update(SYNTHETIC_MODULE_TEMPLATE.files()[0]!.contents)
      .digest("hex");

    expect(secondDigest).toBe(originalDigest);
  });

  it("digests paths in a fixed order independent of input order", () => {
    const encoder = new TextEncoder();
    const files = [
      { path: "workspace/z.txt", contents: encoder.encode("z") },
      { path: "workspace/A.txt", contents: encoder.encode("a") },
    ];

    expect(digestTemplateFiles(files)).toBe(digestTemplateFiles([...files].reverse()));
  });

  it("contains only synthetic app-relative files", () => {
    expect(SYNTHETIC_MODULE_TEMPLATE.files().map((file) => file.path)).toEqual([
      "workspace/app/package.json",
      "workspace/app/pnpm-lock.yaml",
      "workspace/app/src/index.ts",
      "workspace/app/src/index.test.ts",
      "workspace/app/dist/validation.json",
    ]);
  });

  it("pins the supported runtime and package manager for frozen offline installs", () => {
    const files = new Map(SYNTHETIC_MODULE_TEMPLATE.files().map((file) => [
      file.path,
      new TextDecoder().decode(file.contents),
    ]));
    const manifest = JSON.parse(files.get("workspace/app/package.json")!) as {
      packageManager?: string;
      engines?: { node?: string };
    };

    expect(manifest).toMatchObject({
      packageManager: "pnpm@11.13.1",
      engines: { node: ">=22 <23" },
    });
    expect(files.get("workspace/app/pnpm-lock.yaml")).toBe([
      "lockfileVersion: '9.0'",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "importers:",
      "  .: {}",
      "",
    ].join("\n"));
  });

});
