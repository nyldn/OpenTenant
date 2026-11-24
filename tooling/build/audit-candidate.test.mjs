import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditCandidate, screen } from './audit-candidate.mjs';
import { digest } from './release-obligations.mjs';
test('screens report counts without returning matched values', () => {
  const secret = randomBytes(24).toString('hex');
  const result = screen(`postgresql://synthetic:${secret}@example.test/db /home/synthetic/path rejectUnauthorized: false COPY contacts FROM stdin;`);
  assert(result.secret > 0 && result.identifier > 0 && result.tenantData > 0 && result.security > 0);
  assert(!JSON.stringify(result).includes(secret));
});
test('candidate audit includes deleted history and packed bytes, verifies digests and binds source revision', () => {
  const root = mkdtempSync(join(tmpdir(), 'r8-audit-test-'));
  const git = args => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe', encoding: 'utf8' });
  try {
    git(['init', '-q']); git(['config', 'user.name', 'Synthetic']); git(['config', 'user.email', 'synthetic@example.test']);
    const secret = randomBytes(24).toString('hex');
    writeFileSync(join(root, 'historical.txt'), `postgresql://synthetic:${secret}@example.test/db`);
    git(['add', '.']); git(['commit', '-qm', 'synthetic input']);
    git(['rm', 'historical.txt']); git(['commit', '-qm', 'delete synthetic input']);
    const revision = git(['rev-parse', 'HEAD']).trim();
    mkdirSync(join(root, 'package')); writeFileSync(join(root, 'package/index.js'), 'rejectUnauthorized: false');
    const archive = join(root, 'artifact.tgz'); execFileSync('tar', ['-czf', archive, '-C', root, 'package']);
    const artifact = { filename: 'artifact.tgz', sha512: digest(readFileSync(archive)) };
    const evidence = [{ name: 'synthetic', ...artifact, obligations: { source: { ...artifact, revision }, unattributedCopies: 0 } }];
    const evidencePath = join(root, 'evidence.json'); writeFileSync(evidencePath, JSON.stringify(evidence));
    const report = auditCandidate({ root, evidencePath, gitleaks: false, expectedNames: ['synthetic'] });
    assert.equal(report.status, 'blocked'); assert.equal(report.counts.commits, 2);
    assert(report.counts.history.secret > 0); assert(report.counts.artifactsScreen.security > 0);
    assert(!JSON.stringify(report).includes(secret)); assert.equal(report.ownerApproval, false);
    evidence[0].obligations.source.revision = 'mismatched'; writeFileSync(evidencePath, JSON.stringify(evidence));
    assert.throws(() => auditCandidate({ root, evidencePath, gitleaks: false, expectedNames: ['synthetic'] }), /revision differs/u);
    evidence[0].obligations.source.revision = revision; evidence[0].sha512 = 'invalid'; evidence[0].obligations.source.sha512 = 'invalid';
    writeFileSync(evidencePath, JSON.stringify(evidence));
    assert.throws(() => auditCandidate({ root, evidencePath, gitleaks: false, expectedNames: ['synthetic'] }), /integrity check failed/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
