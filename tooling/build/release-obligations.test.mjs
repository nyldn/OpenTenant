import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCopiedCode, writeObligations } from './release-obligations.mjs';
test('unattributed or incompatible copies fail without echoing source', () => {
  const text = '// Copied from a synthetic upstream';
  assert.throws(() => checkCopiedCode([{ path: 'a.js', text }], [], ''), /^AssertionError.*provenance missing/u);
  assert.throws(() => checkCopiedCode([{ path: 'a.js', text }], [{ path: 'a.js', license: 'GPL-3.0' }], ''), /incompatible/u);
});
test('owner-attested first-party origin passes only with a complete attestation and retained header', () => {
  const text = '-- schema ported from the engage help-desk\n-- design onto RLS';
  const record = { path: 'a.sql', origin: 'first-party', header: 'ported from the engage help-desk', attestedBy: 'owner', attestedOn: '2026-11-17', reason: 'Owner project.' };
  assert.doesNotThrow(() => checkCopiedCode([{ path: 'a.sql', text }], [record], ''));
  assert.doesNotThrow(() => checkCopiedCode([{ path: 'pkg/dist/a.sql', text }], [record], ''));
  assert.doesNotThrow(() => checkCopiedCode([{ path: 'package/sql/0001.sql', text }], [record], ''));
  assert.throws(() => checkCopiedCode([{ path: 'package/other/a.sql', text }], [record], ''), /provenance missing/u);
  for (const broken of [{ attestedBy: 'agent' }, { attestedOn: 'yesterday' }, { reason: ' ' }]) {
    assert.throws(() => checkCopiedCode([{ path: 'a.sql', text }], [{ ...record, ...broken }], ''), /attestation incomplete/u);
  }
  assert.throws(() => checkCopiedCode([{ path: 'a.sql', text: '-- copied from elsewhere' }], [record], ''), /header or notice missing/u);
});
test('per-artifact obligations reject incompatible licences and include original notices and source material', () => {
  const root = mkdtempSync(join(tmpdir(), 'r8-obligations-'));
  try {
    writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'Synthetic original notices');
    writeFileSync(join(root, 'LICENSE'), 'Synthetic licence text');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic', version: '0.1.0', license: 'AGPL-3.0-only' }));
    const unpacked = join(root, 'packed'); mkdirSync(unpacked);
    writeFileSync(join(unpacked, 'package.json'), readFileSync(join(root, 'package.json')));
    const args = { root, packagePath: root, unpacked, files: [], source: { revision: 'synthetic', filename: 'source.tgz', sha512: 'synthetic' }, policy: { allowedLicenses: [], existingRuntimeExceptions: {} }, records: [], target: 'node22-esm-linux-x64' };
    const result = writeObligations(args);
    assert.equal(result.closurePackages, 1);
    assert(readFileSync(join(unpacked, 'RELEASE-NOTICES.md'), 'utf8').includes('Synthetic original notices'));
    assert.equal(JSON.parse(readFileSync(join(unpacked, 'RELEASE-SOURCE.json'))).source.filename, 'source.tgz');
    assert.equal(JSON.parse(readFileSync(join(unpacked, 'RELEASE-SBOM.spdx.json'))).packages.length, 1);
    rmSync(join(unpacked, 'RELEASE-LICENSES'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic', version: '0.1.0', license: 'UNLICENSED' }));
    assert.throws(() => writeObligations(args), /incompatible production licence/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
