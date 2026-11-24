# Technical licence and provenance review

Date: 2026-07-20

Dependency refresh: 2026-07-22 (`sharp`/libvips security update)

Status: **technical review completed; legal/publication clearance not granted**.

This review covers the current private OpenTenant source tree, the Git history
reachable from local and remote branches, and the dependency closure installed
on macOS arm64 with Node.js 22 and pnpm 11.13.1. It provides reproducible
engineering evidence for qualified counsel. It is not legal advice, a title
opinion, trademark clearance, or an assertion that the reviewer owns rights
that only the project owner can establish.

## Executive conclusion

The technical scan found no dependency licence outside the explicitly reviewed
set described below. The source tree has no vendored dependency directory,
executable binary, font, or photograph. The later Apache-licensed tenant UI
starter includes three deliberately generated shadcn/ui primitives under MIT;
its exact registry digest, licence and copyright notice are preserved beside
the starter. One unreferenced social-logo sprite with no recorded provenance
was removed during the initial review.

Public release and commercial licensing remain blocked until the owner names
the copyright/licensing entity, attests to the pre-import source and asset
provenance, completes trademark clearance, and obtains qualified legal review.
Any distributed image, container, binary, or hosted-download bundle also needs
an artifact-specific bill of materials, licence texts, notices, and source or
relinking material where applicable.

## Repository-origin evidence

- The repository was private at the review checkpoint. The branch and remote
  history were re-enumerated after the Clerk dependency refresh, all under one Git
  author identity. Local stash refs were excluded from this count.
- No co-author or signed-off contribution trailers appear in reachable commit
  messages. External contributions remain disabled by `CONTRIBUTING.md`.
- Git can prove what entered this repository and when, but cannot prove who
  authored material before the initial clean import. The owner must supply that
  attestation before publication or commercial relicensing.
- No `vendor`, `third_party`, or equivalent tracked directory exists.
- The only tracked visual assets after remediation are simple OpenTenant and
  synthetic Example Organisation SVG marks. They contain no embedded bitmap,
  font, author metadata, or external URL. The OpenTenant name and marks still
  require trademark clearance.
- Scans for copied/adapted-source markers found only the explicit sandboxd
  evidence statement that no source was copied. No production import of the
  reviewed Vercel CLI-auth, libvips, or Lightning CSS packages exists; they are
  transitive dependencies.
- Full reachable history contained no private-key or common provider-token
  pattern. This pattern scan supplements, but does not replace, the final
  GitHub secret/history review before visibility changes.

## OpenTenant licence boundaries

| Material | Declared licence | Evidence |
|---|---|---|
| Core application, modules, packages, tests, migrations, and tooling | `AGPL-3.0-only` | Root `LICENSE`; 17 workspace manifests |
| Remote module SDK | `Apache-2.0` | `packages/module-sdk/LICENSE`; package SPDX header and manifest |
| Tenant module Next.js UI starter | `Apache-2.0` plus retained MIT shadcn/ui notice | `templates/tenant-module-nextjs/LICENSE`; package manifest and local third-party notices |
| Documentation | `CC-BY-SA-4.0` | `docs/LICENSE`; `LICENSING.md` |
| Generated graph report | `CC-BY-SA-4.0` with indexed-source licences retained | `LICENSING.md` |
| Generated graph data/relationships | `AGPL-3.0-only` where copyrightable, with indexed-source licences retained | `LICENSING.md` |
| Names and marks | No grant through the code/document licences | `TRADEMARKS.md` |

All 19 workspace manifests have an explicit SPDX licence expression: 17 are
`AGPL-3.0-only`; `packages/module-sdk` and the tenant-module UI starter are
`Apache-2.0`. Both Apache texts are token-for-token equivalent to each other;
the module SDK copy was previously checked against the SPDX licence-list text.
The AGPL text differs
from the SPDX rendering only by the FSF URLs using HTTPS rather than HTTP. The
Creative Commons file includes the licensor/licensee guidance surrounding the
legal code, so it is intentionally not byte-identical to SPDX's rendering.

Authoritative references:

- [GNU Affero General Public License 3.0](https://www.gnu.org/licenses/agpl-3.0.html)
- [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- [Creative Commons BY-SA 4.0 legal code](https://creativecommons.org/licenses/by-sa/4.0/legalcode)
- [SPDX licence list](https://spdx.org/licenses/)

## Installed dependency closure

`pnpm licenses list --json` reports 629 package records; 590 are in the
production closure. Counts are package records rather than unique legal works.

| Licence expression | Records |
|---|---:|
| MIT | 517 |
| Apache-2.0 | 58 |
| ISC | 31 |
| BSD-3-Clause | 6 |
| BSD-2-Clause | 3 |
| BlueOak-1.0.0 | 3 |
| MPL-2.0 | 2 |
| LGPL-3.0-or-later | 1 |
| CC-BY-4.0 | 1 |
| 0BSD | 1 |
| Apache-2.0 AND MIT | 1 |
| MIT AND Zlib | 1 |
| MIT OR CC0-1.0 | 1 |
| MIT AND ISC | 1 |
| Unlicense | 1 |
| Unknown manifest metadata | 1 |

The complete reproducible inventory command and exact reviewed exceptions are
recorded in `THIRD_PARTY_NOTICES.md` and the lockfile.

### Conditional and anomalous records

| Package | Role and result | Required release treatment |
|---|---|---|
| `@vercel/cli-auth@0.0.1` | Production transitive through `workflow`; manifest omits `license`, but its installed package contains the Apache-2.0 text with Vercel's copyright notice and registry metadata points to the Vercel monorepo. No direct OpenTenant import. | Retain the included Apache licence and copyright notice; continue failing review if the exact exception changes. |
| `@img/sharp-libvips-darwin-arm64@1.3.2` | Production optional platform bundle through `sharp@0.35.3`/Next; manifest is `LGPL-3.0-or-later` and registry metadata points to the upstream `sharp-libvips` source/build repository. Its README enumerates libvips and bundled third-party libraries, but the package has no standalone `LICENSE` file. | For every distributed platform artifact, preserve the upstream notices and satisfy applicable LGPL source/relinking requirements. Counsel must validate the chosen container/binary distribution. |
| `lightningcss@1.32.0` and Darwin binary | MPL-2.0 through Tailwind build processing; unmodified and not directly imported. | Preserve MPL notices and make covered source/modifications available when an executable form is distributed. |
| `caniuse-lite@1.0.30001805` | CC-BY-4.0 browser-compatibility data through Next; installed licence text is present. | Preserve attribution, licence reference, and change indication in any artifact that redistributes the data. |

Primary upstream references:

- [`@vercel/cli-auth` source](https://github.com/vercel/vercel/tree/main/packages/cli-auth)
- [`sharp-libvips` source and build material](https://github.com/lovell/sharp-libvips)
- [Mozilla Public License 2.0 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)
- [GNU Lesser GPL 3.0](https://www.gnu.org/licenses/lgpl-3.0.html)
- [Creative Commons BY 4.0](https://creativecommons.org/licenses/by/4.0/)

### Clerk dependency refresh

The complete Clerk browser/backend addition was reviewed after the original
closure snapshot. Direct `@clerk/backend@3.11.7` and
`@clerk/nextjs@7.5.20`, plus transitive `@clerk/react@6.12.5` and
`@clerk/shared@4.25.5`, declare MIT, point to the Clerk JavaScript repository,
and include packaged licence files. Their installed licence texts were checked
without copying package source into OpenTenant. `fast-sha256@1.3.0` enters
through Clerk's `standardwebhooks` dependency, declares Unlicense, points to
its public source repository, and includes its licence file. No new copyleft,
unknown-metadata, binary, font, image, or vendored-source exception was added.

The refreshed production audit reports no known vulnerabilities. Clerk SDK
imports remain confined to the Clerk auth adapter and the Next.js composition
boundary; provider response objects are validated and not copied into public
platform contracts.

## Integrity and security-adjacent evidence

- `pnpm install --frozen-lockfile` passes and the lockfile includes registry
  integrity values for the reviewed package revisions.
- The one `pnpm store status` mutation is `esbuild@0.28.1`. Its permitted
  install script replaces the JavaScript launcher with the platform binary
  only after checking the binary against esbuild's embedded SHA-256 table.
  This expected side effect means `pnpm store status` alone is not a clean
  provenance signal for esbuild; the lockfile, platform-package integrity, and
  install-script hash check are the applicable evidence.
- The production audit initially found PostCSS `<8.5.10` through Next. A pnpm
  workspace override now resolves all consumers to `8.5.15`; the production
  audit reports no known vulnerabilities.
- GitHub later reported `GHSA-f88m-g3jw-g9cj` in sharp's inherited libvips
  closure. Next 15's optional range stops below the patched line, so the pnpm
  workspace policy resolves every Next path to Apache-2.0 `sharp@0.35.3` and
  LGPL-3.0-or-later `@img/sharp-libvips-darwin-arm64@1.3.2`. The production
  audit is clean, the Node 22 native module reports libvips 8.18.3, and an
  in-memory PNG encode/read probe passes. No package source was copied.
- No dependency package or provider SDK source was copied into the repository.
  The only intentional registry-generated source is the three MIT shadcn/ui
  primitives in the permissively licensed tenant UI starter, with exact
  provenance and notice preserved beside them. No Shadcn Studio source or
  credential is present in the repository.
- No Clerk package source, template, logo, or screenshot is tracked in the
  repository; browser screenshots remain ignored local verification artifacts.

## Remediation completed in this review

1. Removed unused `apps/platform/public/icons.svg`, which contained third-party
   social marks without a source or licence record and had no call site.
2. Pinned the transitive PostCSS resolution to `8.5.15` in
   `pnpm-workspace.yaml` and regenerated the frozen lockfile.
3. Added `THIRD_PARTY_NOTICES.md` so conditional dependency provenance and
   artifact-release obligations have a stable repository location.
4. Pinned the transitive sharp resolution to `0.35.3`, refreshed the exact
   libvips notice, and added a high-severity production audit gate to CI.

## Remaining owner and counsel gates

These are not tasks an automated technical reviewer can truthfully complete:

1. Name the legal copyright, commercial-licensing, and trademark steward.
2. Attest that the initial source, assessment content, copy, and four remaining
   SVG assets were authored by or validly assigned/licensed to that steward.
3. Have qualified counsel approve AGPL/commercial dual licensing, the SDK and
   documentation exceptions, LGPL/MPL/CC treatment, and the contributor
   agreement.
4. Complete trademark clearance for OpenTenant and approve the trademark
   policy.
5. Generate and verify notices/source material against each actual release
   artifact; the installed macOS arm64 closure cannot stand in for Linux
   containers or other supported platforms.
6. Approve `SECURITY.md`, the code of conduct, contribution terms, and the final
   public-history/security review before making the private repository public.

## Reproduction commands

```bash
pnpm install --frozen-lockfile
pnpm licenses list --json
pnpm licenses list --prod --json
pnpm why -r @vercel/cli-auth @img/sharp-libvips-darwin-arm64 lightningcss caniuse-lite
pnpm audit --prod --audit-level low
git rev-list --branches --remotes --tags
git ls-files
git diff --check
```

Review this document again whenever the lockfile, licence boundaries, assets,
release format, supported platform, contributor set, or commercial model
changes.
