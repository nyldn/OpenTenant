import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

export const repositoryRoot = resolve(import.meta.dirname, "../..");

// Include new, untracked source as well as tracked files. Build output and
// dependencies follow the repository's ignore rules and never enter the scan.
export function sourceInventory() {
  const paths = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: repositoryRoot, encoding: "utf8" });
  return [...new Set(paths.split("\0"))].filter(path => /\.[cm]?[jt]sx?$/u.test(path) && !path.startsWith("graphify-out/"));
}

/** @param {string} path @param {string} [source] */
export function inspectEnvironment(path, source = readFileSync(resolve(repositoryRoot, path), "utf8")) {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  let environmentReads = 0;
  const databaseVariables = new Set();
  /** @param {ts.Node} node */
  function visit(node) {
    // Count the whole environment too: spreads, destructuring, aliases and
    // fixture writes must stay within the reviewed per-file budget.
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      && node.expression.getText(ast) === "process"
      && (ts.isPropertyAccessExpression(node) ? node.name.text : node.argumentExpression?.getText(ast).replace(/["']/gu, "")) === "env") environmentReads++;
    // Conservative discovery includes fixture writes and helper arguments.
    // Those need explicit exemptions, rather than an implicit mock heuristic.
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && /^(?:[A-Z_]*_)?DATABASE_URL$/u.test(node.text)) databaseVariables.add(node.text);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { environmentReads, databaseVariables: [...databaseVariables].sort() };
}

/** @param {string} source */
export function environmentBudgetSnapshot(source) {
  const ast = ts.createSourceFile("environment-policy.mjs", source, ts.ScriptTarget.Latest, true);
  const budgets = new Map();
  /** @param {ts.Node} node */
  function visit(node) {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && ts.isNumericLiteral(node.initializer)) {
      budgets.set(node.name.text, Number(node.initializer.text));
    }
    ts.forEachChild(node, visit);
  }
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(ast) === "environmentReadExceptions" && declaration.initializer) visit(declaration.initializer);
    }
  }
  if (source.includes("export const environmentReadExceptions") && budgets.size === 0) throw new Error("Cannot parse reviewed environment inventory");
  return budgets;
}

/** @param {string} path @param {string} source */
export function isTestSource(path, source) {
  return /\.(?:test|spec|integration)\.[cm]?[jt]sx?$/u.test(path)
    || /from\s+["'](?:node:test|vitest|@playwright\/test)["']/u.test(source);
}
