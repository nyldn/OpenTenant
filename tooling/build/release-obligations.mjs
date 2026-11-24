import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';

const json = path => JSON.parse(readFileSync(path, 'utf8'));
export const digest = bytes => createHash('sha512').update(bytes).digest('hex');
const workspaceLicense = new Set(['AGPL-3.0-only', 'Apache-2.0']);
const copiedMarker = /\b(?:adapted|copied|ported|vendored)\s+from|SPDX-License-Identifier:|copyright\s+(?!.*OpenTenant)/iu;

/** Resolve installed production edges without loading code or consulting a registry. */
export function installedClosure(start) {
  const seen = new Map(), edges = [], absentOptional = [];
  function visit(directory) {
    const path = realpathSync(directory), manifest = json(join(path, 'package.json'));
    if (seen.has(path)) return;
    seen.set(path, { path, manifest });
    const required = { ...manifest.dependencies }, optional = { ...manifest.optionalDependencies };
    for (const name of Object.keys({ ...required, ...optional }).sort()) {
      const search = createRequire(join(path, 'package.json')).resolve.paths(name) ?? [];
      const dependency = search.map(base => join(base, name)).find(candidate => existsSync(join(candidate, 'package.json')));
      if (!dependency) {
        assert(name in optional, 'Required production dependency is absent');
        absentOptional.push({ parent: manifest.name, name }); continue;
      }
      const target = realpathSync(dependency);
      edges.push({ from: path, to: target }); visit(target);
    }
  }
  visit(start);
  return { entries: [...seen.values()], edges, absentOptional };
}

/** Known copied source must retain both its header and the reviewed exact-revision notice. */
export function checkCopiedCode(files, records, notices) {
  for (const { path, text } of files) {
    // Packages ship emitted copies under dist/ and raw migration copies under sql/.
    const record = records.find(record => record.path === path || (/(^|\/)(dist|sql)\//u.test(path) && text.includes(record.header)));
    if (!copiedMarker.test(text) && !record) continue;
    // Owner-attested first-party origin: no third-party licence applies, but
    // the attestation must be complete and the reviewed header must remain.
    if (record?.origin === 'first-party') {
      assert(record.attestedBy === 'owner' && /^\d{4}-\d{2}-\d{2}$/u.test(record.attestedOn ?? '') && record.reason?.trim(), 'First-party provenance attestation incomplete');
      assert(record.header && text.includes(record.header), 'Copied-code header or notice missing');
      continue;
    }
    assert(record && /^(MIT|Apache-2.0|BSD-2-Clause|BSD-3-Clause|ISC|PostgreSQL)$/u.test(record.license), 'Copied-code provenance missing or incompatible');
    assert(/^[a-f0-9]{40}$/u.test(record.commit) && /^https:\/\//u.test(record.source), 'Copied-code revision/source missing');
    assert(text.includes(record.header) && notices.includes(record.commit) && notices.includes(record.source), 'Copied-code header or notice missing');
  }
}

function licenseTexts(path) {
  const names = readdirSync(path, { withFileTypes: true });
  const texts = names.filter(entry => entry.isFile() && /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/iu.test(entry.name))
    .map(entry => ({ name: entry.name, text: readFileSync(join(path, entry.name), 'utf8') }));
  if (!texts.length) {
    for (const entry of names.filter(entry => entry.isFile() && /^readme/iu.test(entry.name))) {
      const text = readFileSync(join(path, entry.name), 'utf8');
      const section = text.match(/^#+ Licen[cs]e\s*$/imu);
      if (section) texts.push({ name: `${entry.name} licence section`, text: text.slice(section.index) });
    }
  }
  return texts;
}

/** The target is an unbundled npm ESM artifact. Containers and native distributions require another inventory. */
export function writeObligations({ root, packagePath, unpacked, files, source, policy, records, target }) {
  const { entries, edges, absentOptional } = installedClosure(packagePath);
  const own = json(join(unpacked, 'package.json'));
  const notices = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const sourceFiles = files.filter(file => /\.(?:js|sql)$/u.test(file)).map(path => ({
    path: relative(root, join(packagePath, path)),
    text: readFileSync(join(unpacked, path), 'utf8'),
  }));
  let unattributedCopies = 0;
  for (const file of sourceFiles) {
    try { checkCopiedCode([file], records, notices); } catch { unattributedCopies++; }
  }
  const packages = [], ids = new Map();
  const licenseDirectory = join(unpacked, 'RELEASE-LICENSES'); mkdirSync(licenseDirectory);
  for (const [index, { path, manifest }] of entries.entries()) {
    const workspace = !path.includes('/node_modules/'), key = `${manifest.name}@${manifest.version}`;
    const license = manifest.license;
    assert(workspace ? workspaceLicense.has(license) : policy.allowedLicenses.includes(license) || policy.existingRuntimeExceptions[key] === license,
      'Unreviewed or incompatible production licence');
    assert(!(own.license === 'Apache-2.0' && workspace && license === 'AGPL-3.0-only'), 'Apache artifact depends on AGPL workspace code');
    const texts = licenseTexts(path);
    if (workspace && !texts.length) texts.push({ name: 'LICENSE', text: readFileSync(join(root, 'LICENSE'), 'utf8') });
    assert(!workspace || texts.length > 0, 'Distributed workspace licence text missing');
    const id = `SPDXRef-Package-${index}`; ids.set(path, id);
    for (const [number, text] of texts.entries()) writeFileSync(join(licenseDirectory, `${index}-${number}.txt`), `${key}: ${text.name}\n\n${text.text}`);
    packages.push({ SPDXID: id, name: manifest.name, versionInfo: manifest.version, downloadLocation: 'NOASSERTION',
      filesAnalyzed: false, licenseDeclared: license === 'MIT License' ? 'MIT' : license,
      licenseConcluded: 'NOASSERTION', primaryPackagePurpose: 'LIBRARY',
      comment: path === realpathSync(packagePath) ? 'Distributed unbundled ESM artifact' : `External runtime dependency, not bundled in this archive; licence text ${texts.length ? 'included' : 'unavailable locally, obtain before redistribution'}` });
  }
  writeFileSync(join(unpacked, 'RELEASE-NOTICES.md'), `${notices}\n\n## Artifact closure\n\nTarget: ${target}.\n\n${packages.map(p => `- ${p.name}@${p.versionInfo}: ${p.licenseDeclared}`).join('\n')}\n`);
  const obligations = { schema: 1, target, releaseBlocked: unattributedCopies > 0, unattributedCopies, distribution: 'unbundled-npm-esm', license: own.license, source,
    build: 'pnpm install --frozen-lockfile --ignore-scripts; pnpm exec turbo run build --concurrency=2',
    requirements: own.license === 'AGPL-3.0-only'
      ? ['Distribute this exact corresponding-source archive with the artifact and preserve notices', 'Owner must provide any AGPL section 13 network source offer before hosted use']
      : ['Preserve Apache-2.0 licence, notices and modification notices'],
    externalDependencies: 'Not bundled. MPL source and LGPL source/relinking duties must be discharged if these dependencies are redistributed in another artifact.',
    absentOptional, peerDependencies: own.peerDependencies ?? {},
    ownerGates: ['Authorship/assignment attestation', 'Final candidate history and security review', 'Actual target inventory and public release approval'] };
  writeFileSync(join(unpacked, 'RELEASE-SOURCE.json'), JSON.stringify(obligations, null, 2) + '\n');
  const sbom = { spdxVersion: 'SPDX-2.3', dataLicense: 'CC0-1.0', SPDXID: 'SPDXRef-DOCUMENT',
    name: `${own.name} ${target}`, documentNamespace: `https://spdx.org/spdxdocs/opentenant-${digest(Buffer.from(JSON.stringify([target, own.name, source.revision, packages]))).slice(0, 32)}`,
    creationInfo: { creators: ['Tool: opentenant-release-obligations'], created: new Date().toISOString() },
    documentDescribes: [ids.get(realpathSync(packagePath))], packages,
    relationships: [{ spdxElementId: 'SPDXRef-DOCUMENT', relationshipType: 'DESCRIBES', relatedSpdxElement: ids.get(realpathSync(packagePath)) },
      ...edges.map(edge => ({ spdxElementId: ids.get(edge.from), relationshipType: 'DEPENDS_ON', relatedSpdxElement: ids.get(edge.to) }))] };
  writeFileSync(join(unpacked, 'RELEASE-SBOM.spdx.json'), JSON.stringify(sbom, null, 2) + '\n');
  return { target, closurePackages: packages.length, absentOptional: absentOptional.length, source, unattributedCopies };
}
