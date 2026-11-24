import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [mode = '--staged', ref = 'HEAD', ...extra] = process.argv.slice(2);
const history = mode === '--history';
if ((!history && mode !== '--staged') || extra.length || (!history && process.argv.length > 3)) {
  console.error('Usage: node tooling/ci/repository-privacy.mjs [--staged | --history [commit]]');
  process.exit(2);
}

function run(command, args, statusCodes = [0], input) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  if (!statusCodes.includes(result.status)) {
    console.error(`${command} check failed. Verify Git history and Gitleaks installation.`);
    process.exit(2);
  }
  return result;
}

if (history && run('git', ['rev-parse', '--is-shallow-repository']).stdout.trim() !== 'false') {
  console.error('Fetch the full Git history before running the repository privacy check.');
  process.exit(2);
}
const revision = history
  ? run('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).stdout.trim()
  : null;

const localDirectory = /^(?:\.local|\.claude|\.codex|\.t3|\.vercel|\.uat(?:-audit)?|\.ssh|\.aws|\.gcloud|\.direnv|\.opentenant|\.octo|\.claude-octopus|graphify-out|playwright-report|test-results|node_modules|coverage|dist|\.next|\.turbo)$/iu;
const privatePaths = new Set([
  'config/deploy.yml',
  'docs/REMOTE-DEVELOPMENT.md',
  'docs/FABLE5-HANDOFF.md',
  'docs/OPUS5-HANDOFF.md',
  'docs/tooling/fable5-optimizer.md',
  'docs/tooling/marketing-sync.md',
  'docs/reviews/2026-09-29-public-history-audit.md',
]);
const privateFile = /^(?:\.env(?:\..*)?|\.envrc|\.npmrc|\.netrc|(?:credentials|service-account).*\.json|.*\.(?:pem|key|p12|pfx|dump|backup|sqlite3?|db|csv|ndjson|jsonl|har|zip|tgz|tar(?:\.gz)?|log))$/iu;

function blockedPath(path) {
  const parts = path.split('/');
  const file = parts.pop();
  return parts.some(part => localDirectory.test(part))
    || (file !== '.env.example' && privateFile.test(file))
    || privatePaths.has(path)
    || /^(?:output\/|docs\/architecture\/archify\/.*\.html$|docs\/architecture\/archify\/.*\.visual-check\.)/u.test(path);
}

const pathArgs = revision
  ? ['log', '--format=', '--name-only', '--no-renames', '--diff-filter=ACMRTUXB', '-m', '-z', revision]
  : ['ls-files', '-z'];
const paths = new Set(run('git', pathArgs).stdout.split('\0').map(path => path.replace(/^\n+/u, '')));
const blocked = [...paths].filter(blockedPath).length;
if (blocked) {
  console.error(`Repository privacy check found ${blocked} blocked path(s). Inspect the index or commit history locally.`);
  process.exit(1);
}

// The optional local list holds private literal markers and stays outside Git.
const markerPath = resolve('.local/private-markers.txt');
const metadata = revision ? run('git', ['log', '--format=%B%n%an <%ae>%n%cn <%ce>', revision]).stdout : '';
if (existsSync(markerPath)) {
  const markers = readFileSync(markerPath, 'utf8').split(/\r?\n/u).filter(Boolean);
  if (markers.length) {
    const filesMatch = revision
      ? markers.some(marker => {
        const literal = marker.replace(/[.*+?^$(){}|[\]\\]/gu, '\\$&');
        return run('git', ['log', '--format=%H', '--full-history', '--diff-merges=first-parent',
          '--regexp-ignore-case', '-G', literal, revision]).stdout.length > 0;
      })
      : run('git', ['grep', '--quiet', '--cached', '--fixed-strings', '--ignore-case',
        ...markers.flatMap(marker => ['-e', marker])], [0, 1]).status === 0;
    const markerMatches = value => {
      const lower = value.toLowerCase();
      return markers.some(marker => lower.includes(marker.toLowerCase()));
    };
    if (filesMatch || markerMatches(metadata) || [...paths].some(markerMatches)) {
      console.error('Repository privacy check found a private local marker. Review locally.');
      process.exit(1);
    }
  }
}

const scanFlags = [
  '--redact=100', '--no-banner', '--no-color', '--ignore-gitleaks-allow',
  '--config', '.gitleaks.toml',
];
const content = run('gitleaks', [
  'git', ...scanFlags,
  ...(revision ? ['--log-opts=' + revision + ' --full-history --diff-merges=first-parent'] : ['--staged']),
  '.',
], [0, 1]);
const commitInfo = metadata ? run('gitleaks', ['stdin', ...scanFlags], [0, 1], metadata) : null;
if (content.status === 1 || commitInfo?.status === 1) {
  console.error('Gitleaks flagged the Git input. Inspect the index or commit history locally with redaction.');
  process.exit(1);
}
console.log('Repository privacy check passed.');
