# Preliminary dependency licence inventory

Date: 2026-07-20

This is a reproducible first pass over the currently installed pnpm dependency
closure. It is not the complete provenance and third-party licence review
required before publication.

This snapshot has been superseded by the completed technical review in
`2026-07-20-technical-licence-provenance-review.md`. It remains as the original
inventory evidence.

## Command

```bash
pnpm licenses list --json
```

## Reported licence groups

| Licence expression | Package records |
|---|---:|
| MIT | 507 |
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
| Unknown metadata | 1 |

Counts are package records reported by pnpm, not unique legal works.

## Items requiring explicit review

### `@vercel/cli-auth@0.0.1`

Pnpm reports unknown licence metadata because the package manifest omits a
`license` field. The distributed package contains the complete Apache License
2.0 text in its `LICENSE` file. It is transitive through
`@workflow/cli -> workflow -> @opentenant/platform` and is not evidence that
OpenTenant uses the prohibited Vercel CLI operationally.

Before publication, verify the exact package revision and upstream repository
provenance rather than relying only on the installed tarball.

### `@img/sharp-libvips-darwin-arm64@1.2.4`

This prebuilt libvips distribution reports `LGPL-3.0-or-later`. Review the
notices, relinking/source-availability obligations, and whether it is included
in any distributed OpenTenant artifact.

### `lightningcss` binaries

`lightningcss` and its Darwin binary report `MPL-2.0`. Confirm file-level
source and notice obligations for any redistributed build artifact.

## Remaining publication work

- Review direct and transitive dependencies for every supported platform, not
  only the current macOS installation.
- Review copied code, generated templates, fonts, icons, images, test fixtures,
  documentation references, and Git history.
- Produce the final third-party notices distributed with source, containers,
  binaries, and hosted downloads.
- Have qualified counsel confirm compatibility with the repository's split
  licence and intended commercial terms.

The owner task remains open until those checks are complete.
