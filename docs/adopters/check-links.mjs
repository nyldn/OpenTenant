// markdown-link-check is ISC. Resolve the pinned pnpm dlx tool, not a global copy.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const binary = process.env.PATH.split(delimiter).map(dir => join(dir, 'markdown-link-check')).find(existsSync);
if (!binary) throw new Error('Run pnpm docs:links to use markdown-link-check@3.15.0');
const toolRequire = createRequire(realpathSync(binary));
const check = toolRequire('markdown-link-check');
const external = '^(?:(?!file:)[a-zA-Z][a-zA-Z0-9+.-]*:|//)';
const options = { ignorePatterns: [{ pattern: external }], ignoreDisable: true };
const run = (content, opts) => new Promise((accept, reject) => check(content, opts, (error, results) => error ? reject(error) : accept(results)));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(path => path === 'README.md' || /^docs\/.*\.md$/i.test(path) || /\/(?:README)\.md$/i.test(path));
const content = new Map();
const read = path => { if (!content.has(path)) content.set(path, readFileSync(path, 'utf8')); return content.get(path); };
const failures = [];
let checked = 0;
let excluded = 0;
let crossAnchors = 0;
(async () => {
  for (const file of files) {
    const results = await run(read(file), { ...options, baseUrl: pathToFileURL(dirname(resolve(file)) + '/').href });
    for (const result of results) {
      if (result.status === 'ignored') { excluded++; continue; }
      checked++;
      if (result.status !== 'alive') { failures.push(`${file}: ${result.link}`); continue; }
      if (result.link.startsWith('#')) continue;
      const target = new URL(result.link, pathToFileURL(resolve(file)));
      if (!target.hash) continue;
      const hash = target.hash;
      target.hash = ''; target.search = '';
      let path = fileURLToPath(target);
      if (statSync(path).isDirectory()) path = join(path, 'README.md');
      if (!existsSync(path)) { failures.push(`${file}: ${result.link} (no anchor document)`); continue; }
      // The upstream file checker checks existence only. Check cross-file fragments
      // with its own heading/HTML-id parser, so both forms use the same rules.
      const anchors = await run(read(path) + `\n[fragment probe](${hash})\n`, { ignoreDisable: true, ignorePatterns: [{ pattern: '^[^#]' }] });
      const probe = anchors.find(anchor => anchor.link === hash);
      crossAnchors++;
      if (!probe || probe.status !== 'alive') failures.push(`${file}: ${result.link} (missing anchor)`);
    }
  }
  for (const failure of failures) console.error(failure);
  console.log(`docs-links: ${files.length} files; ${checked} local links checked, including ${crossAnchors} cross-file anchors; ${excluded} external URLs excluded; ${failures.length} failures`);
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
