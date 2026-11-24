import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const origin = 'opentenant-sql-navigation-v1';
const ident = '(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)(?:\\s*\\.\\s*(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*))?';
const normalize = name => name.replace(/\s+/gu, '').replace(/"((?:[^"]|"")+)"|([a-z_][a-z0-9_$]*)/giu,
  (_, quoted, bare) => quoted === undefined ? bare.toLowerCase() : quoted.replaceAll('""', '"'));
const lineAt = (text, offset) => `L${text.slice(0, offset).split('\n').length}`;

/** Mask comments, data literals and dollar bodies, preserving offsets and newlines. No SQL grammar is claimed. */
export function maskSql(text) {
  let output = '', index = 0;
  const blank = value => value.replace(/[^\n]/gu, ' ');
  while (index < text.length) {
    const rest = text.slice(index);
    let end;
    if (rest.startsWith('--')) end = text.indexOf('\n', index);
    else if (rest.startsWith('/*')) {
      let depth = 1; end = index + 2;
      while (end < text.length && depth) {
        if (text.startsWith('/*', end)) { depth++; end += 2; }
        else if (text.startsWith('*/', end)) { depth--; end += 2; }
        else end++;
      }
    } else if (rest[0] === "'") {
      end = index + 1;
      while (end < text.length) {
        if (text[end] === '\\') { end += 2; continue; }
        if (text[end++] === "'") { if (text[end] !== "'") break; end++; }
      }
    } else if (/^\$(?:[a-z_][a-z0-9_]*)?\$/iu.test(rest)) {
      const tag = rest.match(/^\$(?:[a-z_][a-z0-9_]*)?\$/iu)[0];
      const close = text.indexOf(tag, index + tag.length);
      end = close < 0 ? text.length : close + tag.length;
    } else if (rest[0] === '"') {
      const quoted = rest.match(/^"(?:[^"]|"")*"/u)?.[0] ?? rest;
      output += quoted; index += quoted.length; continue;
    } else { output += text[index++]; continue; }
    if (end < 0) end = text.length;
    output += blank(text.slice(index, end)); index = end;
  }
  return output;
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : [];
  });
}

function sqlLiterals(text, path) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const literals = [];
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literals.push({ text: node.text, offset: node.getStart(source) });
    } else if (ts.isTemplateExpression(node)) {
      // Interpolation is never interpreted as an identifier. Static segments can still contain table references.
      literals.push({ text: node.head.text + node.templateSpans.map(span => `__dynamic__${span.literal.text}`).join(''), offset: node.getStart(source) });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return literals;
}

/** Replace only this tool's overlay. Preserve upstream metadata and warnings. */
export function addSqlNavigation(graph, root) {
  graph.nodes = graph.nodes.filter(node => node._origin !== origin);
  graph.links = graph.links.filter(link => link._origin !== origin);
  const definitions = new Map();
  const node = (id, label, path, location) => ({ id, label, source_file: path, source_location: location,
    file_type: 'code', _origin: origin, community: -1, community_name: 'SQL navigation' });
  const link = (source, target, relation, path, location, confidence = 'EXTRACTED') => ({ source, target, relation,
    source_file: path, source_location: location, confidence, confidence_score: confidence === 'EXTRACTED' ? 1 : 0.8,
    weight: 1, _origin: origin });
  for (const file of filesUnder(resolve(root, 'tooling/migrations/sql')).filter(file => file.endsWith('.sql'))) {
    const path = relative(root, file), text = readFileSync(file, 'utf8'), masked = maskSql(text);
    for (const match of masked.matchAll(new RegExp(`\\bcreate\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(${ident})`, 'giu'))) {
      const name = normalize(match[1]), id = `sql-table:${path}:${name}`, location = lineAt(text, match.index);
      graph.nodes.push(node(id, `SQL table ${name}`, path, location));
      definitions.set(name, [...(definitions.get(name) ?? []), id]);
    }
  }
  let ambiguous = 0, references = 0;
  for (const file of filesUnder(resolve(root, 'packages/database/src')).filter(file => /-store\.ts$/u.test(file) || file.endsWith('credential-cipher-rotation.ts'))) {
    const path = relative(root, file), text = readFileSync(file, 'utf8');
    for (const literal of sqlLiterals(text, file)) {
      for (const match of maskSql(literal.text).matchAll(new RegExp(`\\b(?:from|join|update|insert\\s+into|delete\\s+from)\\s+(${ident})`, 'giu'))) {
        const targets = definitions.get(normalize(match[1]));
        if (!targets) continue;
        if (targets.length !== 1) { ambiguous++; continue; }
        const location = lineAt(text, literal.offset), id = `sql-store:${path}:${location}`;
        if (!graph.nodes.some(existing => existing.id === id)) graph.nodes.push(node(id, `SQL store ${path.split('/').at(-1)} ${location}`, path, location));
        if (graph.links.some(existing => existing.source === targets[0] && existing.target === id)) continue;
        graph.links.push(link(targets[0], id, 'queried_by', path, location, 'INFERRED')); references++;
      }
    }
  }
  graph.graph ??= {};
  graph.graph.opentenant_sql_navigation = { version: 1, extractor: 'bounded lexical SQL / TypeScript AST literals',
    tables: [...definitions.values()].flat().length, references, ambiguous,
    limitations: ['No SQL syntax validation', 'Dynamic identifiers, procedural bodies and ambiguous table names omitted', 'Store references limited to packages/database/src'] };
  return graph.graph.opentenant_sql_navigation;
}

/** Repair semantic provenance only when a cited document contains the exact normalized label. */
export function repairMetadata(graph, root) {
  let repaired = 0, unresolved = 0;
  const words = value => value.toLowerCase().replace(/[^a-z0-9]/gu, '');
  for (const node of graph.nodes.filter(node => node._origin === 'semantic' && !node.source_file)) {
    const citations = graph.links.filter(edge => edge.source === node.id || edge.target === node.id)
      .map(edge => edge.source_file).filter(path => typeof path === 'string' && path.startsWith('docs/') && !path.includes('..'));
    let found = false;
    for (const path of [...new Set(citations)].sort()) {
      if (!existsSync(resolve(root, path))) continue;
      const lines = readFileSync(resolve(root, path), 'utf8').split('\n');
      const index = lines.findIndex(line => words(line).includes(words(node.label)));
      if (index < 0) continue;
      node.source_file = path; node.source_location = `L${index + 1}`;
      node.metadata = { ...node.metadata, source_basis: 'cited document mention, not a code definition' };
      repaired++; found = true; break;
    }
    if (!found) unresolved++;
  }
  return { repaired, unresolved };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? '.'), path = resolve(root, 'graphify-out/graph.json');
  const graph = JSON.parse(readFileSync(path, 'utf8'));
  const summary = addSqlNavigation(graph, root);
  const metadata = repairMetadata(graph, root);
  writeFileSync(path, JSON.stringify(graph, null, 2) + '\n');
  console.log(JSON.stringify({ ...summary, metadata }));
}
