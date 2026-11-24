import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { publicPackages } from './package-inventory.mjs';
import { digest } from './release-obligations.mjs';

const limit = 512 * 1024 * 1024;
const screens = {
  secret: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:postgres(?:ql)?:\/\/[^\s/:]+:)[^\s@]+@|\b(?:sk_live_|ghp_|github_pat_)[a-z0-9_]{16,}/giu,
  identifier: /\/(?:Users|home)\/[a-z0-9_.-]+|https?:\/\/[^\s/"'`]+\.(?:vercel\.app|neon\.tech)|\b[a-z0-9._%+-]+@(?!example\.(?:test|com|org)\b|[^\s@]*noreply\.github\.com\b|localhost\b)[a-z0-9.-]+\.[a-z]{2,}\b/giu,
  tenantData: /\bCOPY\s+[^;\n]+\s+FROM\s+stdin\b|\bINSERT\s+INTO\s+(?:[a-z_]+\.)?(?:tenants|users|contacts|respondents)\b|"(?:tenant_id|tenantId)"\s*:\s*"[^"\n]+"[\s\S]{0,160}"(?:email|phone|address)"/giu,
  security: /\brejectUnauthorized\s*:\s*false\b|\b(?:create|alter)\s+role\b[^;\n]*\b(?:bypassrls|superuser)\b|\b(?:disable|no\s+force)\s+row\s+level\s+security\b/giu,
};
const empty = () => Object.fromEntries(Object.keys(screens).map(key => [key, 0]));
export function screen(text) {
  return Object.fromEntries(Object.entries(screens).map(([category, regex]) => [category, [...text.matchAll(regex)].length]));
}
const add = (target, counts) => { for (const key of Object.keys(target)) target[key] += counts[key]; };
const git = (root, args, options = {}) => execFileSync('git', ['-C', root, ...args], { maxBuffer: limit, stdio: ['pipe', 'pipe', 'pipe'], ...options });

/** All output is aggregate counts. Values, paths, matches and commit subjects never leave this function. */
export function auditCandidate({ root, candidate = 'HEAD', evidencePath, gitleaks = true, expectedNames }) {
  root = resolve(root);
  const revision = git(root, ['rev-parse', '--verify', '--end-of-options', `${candidate}^{commit}`], { encoding: 'utf8' }).trim();
  const commits = git(root, ['rev-list', revision], { encoding: 'utf8' }).trim().split('\n').length;
  const history = empty(), metadata = empty(), artifacts = empty();
  const objectIds = [...new Set(git(root, ['rev-list', '--objects', '--no-object-names', revision], { encoding: 'utf8' }).trim().split('\n'))];
  let blobs = 0, binaries = 0;
  for (let start = 0; start < objectIds.length; start += 16) {
    const batch = git(root, ['cat-file', '--batch'], { input: objectIds.slice(start, start + 16).join('\n') + '\n' });
    let cursor = 0;
    while (cursor < batch.length) {
      const end = batch.indexOf(10, cursor), header = batch.subarray(cursor, end).toString('ascii').split(' ');
      const size = Number(header[2]); assert(Number.isSafeInteger(size), 'Invalid history object');
      const bytes = batch.subarray(end + 1, end + 1 + size);
      if (header[1] === 'blob') {
        blobs++;
        if (bytes.includes(0)) binaries++;
        else add(history, screen(bytes.toString('utf8')));
      }
      cursor = end + 1 + size + 1;
    }
  }
  add(metadata, screen(git(root, ['log', '--format=%B%n%an <%ae>%n%cn <%ce>', revision], { encoding: 'utf8' })));
  const treePaths = git(root, ['log', '--format=', '--name-only', revision], { encoding: 'utf8' });
  const sensitivePaths = treePaths.split('\n').filter(path => /(?:^|\/)(?:\.env(?:\.|$)|[^/]+\.(?:dump|sqlite|csv|pem|key|p12|pfx)$)/iu.test(path)).length;
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  assert(Array.isArray(evidence) && evidence.length > 0, 'Artifact inventory missing');
  const names = evidence.map(artifact => artifact.name).sort();
  assert.deepEqual(names, (expectedNames ?? publicPackages(root).map(item => item.manifest.name)).sort(), 'Artifact inventory is incomplete or duplicated');
  const shallow = git(root, ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() === 'true';
  const inventory = new Map();
  let provenanceBlockers = 0;
  for (const artifact of evidence) {
    assert(artifact.obligations.source.revision === revision, 'Artifact/source revision differs from candidate; repack the exact candidate');
    provenanceBlockers += artifact.obligations.unattributedCopies ?? 0;
    for (const item of [artifact, artifact.obligations.source]) {
      assert(typeof item.filename === 'string' && /^[a-zA-Z0-9_.-]+\.t(?:ar\.)?gz$/u.test(item.filename), 'Invalid artifact filename');
      assert(!inventory.has(item.filename) || inventory.get(item.filename) === item.sha512, 'Conflicting artifact digest');
      inventory.set(item.filename, item.sha512);
    }
  }
  for (const [filename, checksum] of inventory) {
    const archive = resolve(dirname(evidencePath), filename);
    assert(digest(readFileSync(archive)) === checksum, 'Artifact integrity check failed');
    const listing = execFileSync('tar', ['-tzf', archive], { maxBuffer: limit, encoding: 'utf8', stdio: 'pipe' });
    assert(listing.split('\n').every(path => !path.startsWith('/') && !path.split('/').includes('..')), 'Unsafe archive member');
    // Read bytes to stdout rather than extracting paths or trusting symlinks.
    const content = execFileSync('tar', ['-xOzf', archive], { maxBuffer: limit, stdio: 'pipe' });
    add(artifacts, screen(content.toString('utf8')));
  }
  let leakCount = null, leakState = 'not-run';
  if (gitleaks) {
    const temp = mkdtempSync(join(tmpdir(), 'r8-history-scan-'));
    try {
      const path = join(temp, 'report.json');
      const scan = spawnSync('gitleaks', ['git', root, `--log-opts=${revision}`, '--redact=100', '--no-banner', '--no-color', '--report-format=json', '--report-path', path], { stdio: 'pipe', maxBuffer: limit });
      if ([0, 1].includes(scan.status) && existsSync(path)) { leakCount = JSON.parse(readFileSync(path, 'utf8')).length; leakState = 'completed'; }
      else leakState = 'unavailable-or-failed';
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }
  const findings = [...Object.values(history), ...Object.values(metadata), ...Object.values(artifacts), sensitivePaths, provenanceBlockers].reduce((a, b) => a + b, 0);
  return { schema: 1, revision, status: shallow || findings || leakCount !== 0 ? 'blocked' : 'requires-owner-review',
    counts: { commits, objects: objectIds.length, blobs, binaries, artifacts: inventory.size, history, metadata, artifactsScreen: artifacts, sensitivePaths, provenanceBlockers, gitleaks: leakCount },
    gitleaks: leakState, shallowHistory: shallow,
    limits: ['Pattern screens include synthetic fixtures, licences and documentation', 'Binary content needs format-specific/manual review', 'Semantic tenant data, copied authorship and security boundaries require owner review', 'Candidate ancestors only; hosted PRs, issues, CI logs and other refs are outside this audit', 'Current-host npm ESM packages only; no container or other-platform claim'],
    ownerApproval: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), root = resolve('.');
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  try {
    const report = auditCandidate({ root, candidate: option('--candidate', 'HEAD'), evidencePath: resolve(option('--evidence', 'dist/release-evidence/evidence.json')) });
    const output = resolve(option('--output', 'dist/release-evidence/candidate-audit.json'));
    mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report)); process.exitCode = report.status === 'blocked' ? 2 : 0;
  } catch { console.error('Candidate audit failed closed; no finding values emitted. Verify candidate, artifact inventory and local scanner availability.'); process.exitCode = 1; }
}
