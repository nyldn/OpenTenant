import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

async function sources(directory: string): Promise<string[]> {
  // Workflow generates this gitignored SDK endpoint during builds.
  if (directory.endsWith("/app/.well-known/workflow")) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.filter((entry) => !["node_modules", ".next", ".turbo"].includes(entry.name)).map((entry) => entry.isDirectory() ? sources(join(directory, entry.name)) : /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [join(directory, entry.name)] : []))).flat();
}
describe("server logging policy", () => {
  it("rejects console APIs in all platform server source, including computed access", async () => {
    const violations: string[] = [];
    for (const path of await sources(new URL("..", import.meta.url).pathname)) {
      const source = await readFile(path, "utf8");
      if (/^[\s\n]*(?:"use client"|'use client')/.test(source)) continue;
      const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isIdentifier(node) && node.text === "console") violations.push(path);
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
    expect(violations).toEqual([]);
  });
});

describe("typed environment policy", () => {
  it("has no ad hoc environment reads outside configuration and Next runtime selectors", async () => {
    const violations: string[] = [];
    for (const path of await sources(new URL("..", import.meta.url).pathname)) {
      if (path.endsWith("/lib/server-config.ts")) continue;
      const source = await readFile(path, "utf8");
      const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isPropertyAccessExpression(node) && node.expression.getText(ast) === "process" && node.name.text === "env") {
          const parent = node.parent;
          if (!path.endsWith("/instrumentation.ts") || !ts.isPropertyAccessExpression(parent) || parent.name.text !== "NEXT_RUNTIME") violations.push(path);
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
    expect(violations).toEqual([]);
  });
});
