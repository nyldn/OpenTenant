# R8 O17 artifact obligations receipt

Base: `41adc71`. Local preparation only. Marketing impact: none.

The package checker now repacks each actual unbundled npm ESM archive with
`RELEASE-LICENSES/`, `RELEASE-NOTICES.md`, `RELEASE-SOURCE.json` and
`RELEASE-SBOM.spdx.json`. The inventory binds each resulting archive to its
SHA-512 digest, exact candidate source archive and host target. No dependency,
package manifest or lockfile changed. Node, pnpm, tar, Git, publint, ATTW and
Gitleaks are the existing tools used. No publication was performed.

The installed production closure is traversed without loading dependency code
or accessing a registry. Every licence declaration is checked against the
existing exact-version policy. Apache artifacts reject an AGPL workspace
closure. Each artifact's SPDX relationships describe that closure, rather than
assigning the whole workspace closure to every package. Optional dependencies
absent on this host and peer ranges remain explicit. Shared build tooling uses
`neverBundle`; dependency licences refer to external runtime packages, not to
code bundled into the archive.

Full locally available licence and notice texts are included. Some external
packages have a licence declaration but no packaged licence text. Those gaps
are explicitly recorded as requiring the text before redistribution of that
dependency. They are not shipped in these unbundled archives. This proof covers
`node22-esm-linux-x64` only. It does not discharge native binary, container,
MPL source or LGPL source/relinking duties for other distributions. A combined
artifact needs its own inventory and complete corresponding material.

AGPL artifacts identify the exact Git source archive and reproducible build
command. The archive includes original source, lockfile, notices and shared
build scripts. The owner still needs to supply any hosted network source offer
and approve authorship/assignment. Repack after the final candidate is committed;
preliminary archives are not final release evidence. The O19 audit rejects a
source revision that differs from the candidate.

`pnpm package:check` produced all 23 packed packages, per-artifact obligations,
source material and `dist/release-evidence/evidence.json`. File checks,
publint, ATTW, immutable SQL/catalog hashes, licence-policy checks and the
redacted artifact Gitleaks scan passed. Final exit was 1, deliberately blocked
by three copied-code file findings across two packages. These are one existing
tenant-support migration and its emitted/distributed copies, whose porting
header has no qualifying reviewed source/revision/licence notice. The known
ISC migration is covered by the exact revision already in repository notices.
No provenance was fabricated and no historical source was rewritten.

Two synthetic obligation tests passed, including incompatible-licence and
unattributed-copy rejection. Tooling ESLint passed. The screen detects declared
copying markers and registered copied files; it cannot establish authorship
of unmarked pre-import code. Owner attestation remains a separate release gate.

Integrator wiring: the existing `package:check` script already calls the
extended checker. Optional dedicated script: `release:audit` =
`node tooling/build/audit-candidate.mjs`. Retain the archive plus its source
archive and evidence as one private review set. Do not publish it while the
provenance or history gates are blocked.
