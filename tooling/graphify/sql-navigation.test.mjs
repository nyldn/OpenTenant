import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { addSqlNavigation, maskSql, repairMetadata } from './sql-navigation.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
test('mask SQL data, comments and procedural bodies without changing line positions', () => {
  const sql = `-- create table fake (id int);\n/* nested /* create table fake2 (id int) */ */\nselect 'from fake3';\ndo $$ begin create table fake4 (id int); end $$;\ncreate table "real" (id int);`;
  const masked = maskSql(sql);
  assert(!masked.includes('fake'));
  assert(masked.includes('create table "real"'));
  assert.equal(masked.length, sql.length);
  assert.equal(masked.split('\n').length, sql.split('\n').length);
});
test('migration-to-store navigation resolves to source with stable metadata and idempotent updates', () => {
  const graph = { nodes: [], links: [], graph: { upstream: 'preserved' } };
  addSqlNavigation(graph, root);
  const table = graph.nodes.find(node => node.label === 'SQL table tenant_databases');
  assert.equal(table.source_file, 'tooling/migrations/sql/control-plane/0001_init.sql');
  const definition = readFileSync(new URL('../../' + table.source_file, import.meta.url), 'utf8');
  assert(definition.split('\n')[Number(table.source_location.slice(1)) - 1].includes('create table tenant_databases'));
  const edge = graph.links.find(link => link.source === table.id && link.source_file === 'packages/database/src/credential-cipher-rotation.ts' && link.source_location === 'L66');
  assert(edge);
  assert.equal(edge.confidence, 'INFERRED');
  const source = readFileSync(new URL('../../' + edge.source_file, import.meta.url), 'utf8');
  assert(source.split('\n')[65].includes('update tenant_databases set encrypted_connection=$1'));
  const first = JSON.stringify(graph);
  addSqlNavigation(graph, root);
  assert.equal(JSON.stringify(graph), first);
  assert.equal(graph.graph.upstream, 'preserved');
});

test('metadata repair requires a source citation and a label present at the recorded line', () => {
  const graph = { nodes: [{ id: 'mcp', label: 'Developer MCP', _origin: 'semantic' },
    { id: 'unknown', label: 'Absent invented concept', _origin: 'semantic' }],
    links: [{ source: 'mcp', target: 'unknown', source_file: 'docs/reviews/2026-09-06-m3.md' }] };
  assert.deepEqual(repairMetadata(graph, root), { repaired: 1, unresolved: 1 });
  assert(graph.nodes[0].source_location.startsWith('L'));
  assert.equal(graph.nodes[1].source_file, undefined);
});

test('dynamic table names do not fabricate links while dynamic data values preserve static references', () => {
  const root = mkdtempSync(join(tmpdir(), 'r8-sql-dynamic-'));
  try {
    mkdirSync(join(root, 'tooling/migrations/sql'), { recursive: true });
    mkdirSync(join(root, 'packages/database/src'), { recursive: true });
    writeFileSync(join(root, 'tooling/migrations/sql/0001.sql'), 'create table tenant_databases (id text);');
    writeFileSync(join(root, 'packages/database/src/synthetic-store.ts'), [
      'const a = `select * from tenant_databases${suffix}`;',
      'const b = `select * from ${schema}.tenant_databases`;',
      'const c = `select * from tenant_databases where id=${value}`;',
    ].join('\n'));
    const graph = { nodes: [], links: [] };
    assert.equal(addSqlNavigation(graph, root).references, 1);
    assert.equal(graph.links[0].source_location, 'L3');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
