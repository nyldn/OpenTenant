import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { CELLS, SCHEMA_VERSION } from "./inventory.mjs";
export const normalize = value => value.replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/giu, "{uuid}").replace(/#radix-[\w-]+/gu, "#radix-{id}");
export const fingerprint = v => JSON.stringify([v.cell, v.tenant, v.rule, normalize(JSON.stringify(v.target))]);
export function summarize(records) {
  const impact = { critical: 0, serious: 0, moderate: 0, minor: 0 }, rule = {}; let nodes = 0;
  for (const record of records) for (const v of record.violations) {
    impact[v.impact ?? "unknown"] = (impact[v.impact ?? "unknown"] ?? 0) + 1;
    rule[v.rule] = (rule[v.rule] ?? 0) + 1; nodes += v.targets.length;
  }
  return { cells: records.length, productDocuments: records.filter(r => r.kind === "product").length, outcomes: records.reduce((counts, r) => {
    const route = CELLS.find(c => c.id === r.id)?.route.route.split("?")[0].replace("{tenant}", r.tenant);
    const outcome = r.outcome ?? (r.status >= 400 ? "denied" : route !== r.final ? "redirected" : "content");
    counts[outcome] = (counts[outcome] ?? 0) + 1; return counts;
  }, {}), impact, rule, nodes };
}
export function baselineFor(records) {
  validateCells(records);
  const entries = new Map();
  for (const r of records) for (const v of r.violations) for (const target of v.targets) {
    const value = { cell: r.id, tenant: r.tenant, rule: v.rule, impact: v.impact, target, count: 1 };
    const key = fingerprint(value), previous = entries.get(key);
    if (previous) previous.count += 1;
    else entries.set(key, value);
  }
  return { version: SCHEMA_VERSION, cells: records.map(r => ({ id: r.id, status: r.status, final: r.final, kind: r.kind, tenant: r.tenant, headings: (r.diagnostics?.h1 ?? []).map(h => normalize(h ?? "")) })), violations: [...entries.values()], counts: summarize(records) };
}
export function validateCells(records) {
  const expected = new Set(CELLS.map(c => c.id)), seen = new Set();
  for (const r of records) {
    if (!expected.has(r.id) || seen.has(r.id) || !r.completed) throw new Error(`Missing, duplicate or incomplete audit cell: ${r.id}`);
    seen.add(r.id);
  }
  if (seen.size !== expected.size) throw new Error(`Incomplete audit: ${seen.size}/${expected.size} cells`);
}
export function compare(records, baseline) {
  if (baseline.version !== SCHEMA_VERSION) throw new Error("Audit schema mismatch");
  const current = baselineFor(records), errors = [];
  if (baseline.cells.length !== CELLS.length || new Set(baseline.cells.map(c => c.id)).size !== CELLS.length) throw new Error("Baseline inventory mismatch");
  const previousCells = new Map(baseline.cells.map(c => [c.id, c]));
  for (const c of current.cells) if (JSON.stringify(c) !== JSON.stringify(previousCells.get(c.id))) errors.push(`Authorization/document changed: ${c.id}`);
  const previous = new Map(baseline.violations.map(v => [fingerprint(v), v]));
  const now = new Map(current.violations.map(v => [fingerprint(v), v]));
  const severity = { minor: 1, moderate: 2, serious: 3, critical: 4 };
  for (const [key,v] of now) {
    const old = previous.get(key);
    if (!old) errors.push(`New violation: ${key}`);
    else if ((severity[v.impact] ?? 0) > (severity[old.impact] ?? 0) || v.count > old.count) errors.push(`Worse violation: ${key}`);
    else if (v.count < old.count || (severity[v.impact] ?? 0) < (severity[old.impact] ?? 0)) errors.push(`Reduce stale baseline: ${key}`);
  }
  for (const key of previous.keys()) if (!now.has(key)) errors.push(`Remove fixed baseline entry: ${key}`);
  return { pass: errors.length === 0, errors, counts: current.counts };
}
// A manifest is reviewed with the baseline in its own commit. Validate it against
// that commit's parent, then use only the pairs relevant to this comparison. This
// keeps historical remaps checkable without treating them as new allowances.
function reviewedMappings() {
  const cwd = new URL("../../../", import.meta.url);
  const git = args => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
  const paths = readdirSync(new URL(".", import.meta.url)).filter(path => /^remap-[^/]+\.json$/u.test(path)).sort();
  const transitions = new Map();
  const manifests = paths.map(name => {
    const path = `tooling/e2e/audit/${name}`;
    const mapping = JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
    const revision = git(["log", "-1", "--format=%H", "HEAD", "--", path]);
    const historical = Boolean(revision) && JSON.stringify(mapping) === JSON.stringify(JSON.parse(git(["show", `HEAD:${path}`])));
    if (historical) transitions.set(revision, [...(transitions.get(revision) ?? []), mapping]);
    return { mapping, historical };
  });
  for (const [revision, mappings] of transitions) {
    const before = JSON.parse(git(["show", `${revision}^:tooling/e2e/audit/baseline.json`]));
    const after = JSON.parse(git(["show", `${revision}:tooling/e2e/audit/baseline.json`]));
    assertBaselineShrinks(before, after, mappings);
  }
  return manifests;
}
const cellRule = value => JSON.stringify([value.cell, value.rule]);
const targetKey = (mapping, target) => fingerprint({ ...mapping, target });
function validateMapping(mapping, previous, next, usedOld, usedNew) {
  if (!mapping.reason?.trim()) throw new Error("Reviewed mapping needs a reason");
  const oldKey = targetKey(mapping, mapping.old), newKey = targetKey(mapping, mapping.new);
  const old = previous.get(oldKey), value = next.get(newKey);
  if (!old || !value || oldKey === newKey || next.has(oldKey) || previous.has(newKey)) {
    throw new Error("Unknown or unused reviewed target mapping");
  }
  if (usedOld.has(oldKey) || usedNew.has(newKey)) throw new Error("Duplicate reviewed target mapping");
  usedOld.add(oldKey); usedNew.set(newKey, old);
}
// Reviewed document changes may move only these fields; status, kind and
// tenant are authorization evidence and are never remappable.
const DOCUMENT_FIELDS = new Set(["final", "headings"]);
const documentMatches = (cell, fields) => Object.keys(fields).every(k => JSON.stringify(cell[k]) === JSON.stringify(fields[k]));
function validateCellsChange(previous, next, headings, documents = []) {
  const expected = new Set(CELLS.map(c => c.id));
  for (const baseline of [previous, next]) {
    if (baseline.cells.length !== expected.size || new Set(baseline.cells.map(c => c.id)).size !== expected.size
      || baseline.cells.some(c => !expected.has(c.id))) throw new Error("Unknown or duplicate baseline cell");
  }
  const before = new Map(previous.cells.map(c => [c.id, c]));
  const after = new Map(next.cells.map(c => [c.id, c]));
  const reviewed = new Set();
  for (const change of headings) {
    if (reviewed.has(change.cell)) throw new Error("Duplicate heading mapping");
    const old = before.get(change.cell), value = after.get(change.cell);
    if (!change.reason?.trim() || !old || !value || JSON.stringify(change.old) !== JSON.stringify(old.headings)
      || JSON.stringify(change.new) !== JSON.stringify(value.headings) || JSON.stringify(change.old) === JSON.stringify(change.new)) {
      throw new Error("Unknown or unused heading mapping");
    }
    reviewed.add(change.cell);
  }
  const allowed = new Map([...reviewed].map(cell => [cell, ["headings"]]));
  for (const change of documents) {
    const old = before.get(change.cell), value = after.get(change.cell);
    const keys = Object.keys(change.old ?? {});
    if (allowed.has(change.cell)) throw new Error("Duplicate document mapping");
    if (!change.reason?.trim() || !old || !value || keys.length === 0 || keys.some(k => !DOCUMENT_FIELDS.has(k))
      || JSON.stringify(keys.toSorted()) !== JSON.stringify(Object.keys(change.new ?? {}).toSorted())
      || !documentMatches(old, change.old) || !documentMatches(value, change.new)
      || JSON.stringify(change.old) === JSON.stringify(change.new)) {
      throw new Error("Unknown or unused document mapping");
    }
    allowed.set(change.cell, keys);
  }
  for (const value of next.cells) {
    const old = before.get(value.id), masked = { ...value };
    for (const key of allowed.get(value.id) ?? []) masked[key] = old[key];
    if (JSON.stringify(masked) !== JSON.stringify(old)) {
      throw new Error(`Unreviewed authorization/document/heading change: ${value.id}`);
    }
  }
}
export function assertBaselineShrinks(previous, next, reviewed) {
  if (previous.version !== next.version) throw new Error("Baseline schema change requires a separately reviewed migration");
  const entries = new Map(previous.violations.map(v => [fingerprint(v), v]));
  const current = new Map(next.violations.map(v => [fingerprint(v), v]));
  const manifests = reviewed ?? reviewedMappings().map(({ mapping: manifest, historical }) => historical ? ({
    targets: (manifest.targets ?? []).filter(m => !entries.has(targetKey(m, m.new)) && current.has(targetKey(m, m.new))),
    headings: (manifest.headings ?? []).filter(m => previous.cells.some(c => c.id === m.cell && JSON.stringify(c.headings) === JSON.stringify(m.old))
      && next.cells.some(c => c.id === m.cell && JSON.stringify(c.headings) === JSON.stringify(m.new))),
    documents: (manifest.documents ?? []).filter(m => previous.cells.some(c => c.id === m.cell && documentMatches(c, m.old))
      && next.cells.some(c => c.id === m.cell && documentMatches(c, m.new))),
  }) : manifest);
  validateCellsChange(previous, next, manifests.flatMap(m => m.headings ?? []), manifests.flatMap(m => m.documents ?? []));
  const usedOld = new Set(), usedNew = new Map();
  for (const mapping of manifests.flatMap(m => m.targets ?? [])) validateMapping(mapping, entries, current, usedOld, usedNew);
  validateViolationChange(previous, next, entries, usedNew);
}
function validateViolationChange(previous, next, entries, remapped) {
  const severity = { minor: 1, moderate: 2, serious: 3, critical: 4 };
  const totals = new Map();
  const knownCells = new Set(previous.cells.map(c => c.id));
  const knownRules = new Set(previous.violations.map(v => v.rule));
  for (const value of previous.violations) totals.set(cellRule(value), (totals.get(cellRule(value)) ?? 0) + value.count);
  const nextTotals = new Map();
  for (const value of next.violations) {
    const old = entries.get(fingerprint(value)) ?? remapped.get(fingerprint(value));
    if (!knownCells.has(value.cell) || !knownRules.has(value.rule)) throw new Error("Unknown baseline cell or rule");
    if (!old || (severity[value.impact] ?? 0) > (severity[old.impact] ?? 0) || value.count > old.count || !Number.isSafeInteger(value.count) || value.count < 1) {
      throw new Error("Baseline may only shrink; additions require a reviewed same-element mapping");
    }
    const key = cellRule(value), count = (nextTotals.get(key) ?? 0) + value.count;
    nextTotals.set(key, count);
    if (count > (totals.get(key) ?? 0)) throw new Error("Baseline cell × rule count increased");
  }
  if (new Set(next.violations.map(fingerprint)).size !== next.violations.length) throw new Error("Duplicate baseline violation");
}
