# Third-party notices

This repository depends on third-party software and data governed by their own
licences. OpenTenant's licences do not replace those terms. Exact versions and
registry integrity values are in `pnpm-lock.yaml`.

The current installed dependency closure was reviewed on 2026-07-20 and its
sharp/libvips records were refreshed on 2026-07-22 with:

```bash
pnpm licenses list --json
pnpm licenses list --prod --json
```

It contains MIT, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause,
BlueOak-1.0.0, 0BSD, Unlicense, Zlib, CC0-1.0, MPL-2.0,
LGPL-3.0-or-later, and CC-BY-4.0 material. Preserve every dependency's
packaged licence and copyright notice when distributing it.

## Deployment files

`apps/platform/Dockerfile` adapts the multi-stage dependency, standalone build
and non-root runtime pattern from the official Next.js `examples/with-docker`
Dockerfile at commit `62e0b0a85fbff56dd63fc4fe9b02af1e7b9414f4`.
Source: <https://github.com/vercel/next.js/blob/62e0b0a85fbff56dd63fc4fe9b02af1e7b9414f4/examples/with-docker/Dockerfile>.
Licence: MIT, reviewed from
<https://github.com/vercel/next.js/blob/62e0b0a85fbff56dd63fc4fe9b02af1e7b9414f4/license.md>.
The adaptation pins Node 22, uses pnpm 11.13.1 exclusively, copies monorepo
standalone output, adds a migration target and includes an HTTP health check.

`config/deploy.yml.example` is original OpenTenant configuration, offered under
MIT, copyright (c) 2026 OpenTenant contributors. It was written against the
Kamal 2 configuration documentation, not copied from the Kamal source tree.

The following MIT terms apply to these two deployment files. The upstream
Next.js copyright is Copyright (c) 2025 Vercel, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Reviewed conditional records

- `@vercel/cli-auth@0.0.1`: its manifest has no licence field, but the exact
  installed package includes Apache License 2.0 and a Vercel copyright notice.
  Source: <https://github.com/vercel/vercel/tree/main/packages/cli-auth>.
- `@img/sharp-libvips-darwin-arm64@1.3.2`: LGPL-3.0-or-later prebuilt libvips
  bundle with additional third-party libraries listed in its packaged README.
  Source and build material: <https://github.com/lovell/sharp-libvips>.
- `lightningcss@1.32.0` and its platform binary: MPL-2.0. Source:
  <https://github.com/parcel-bundler/lightningcss>.
- `caniuse-lite@1.0.30001805`: CC-BY-4.0 browser-compatibility data. Source:
  <https://github.com/browserslist/caniuse-lite>.

## Reviewed identity-provider additions

- `@clerk/backend@3.11.7`, `@clerk/nextjs@7.5.20`,
  `@clerk/react@6.12.5`, and `@clerk/shared@4.25.5`: MIT packages from
  <https://github.com/clerk/javascript>; each installed package contains its
  licence file.
- `fast-sha256@1.3.0`: Unlicense dependency reached through Clerk's
  `standardwebhooks` dependency. Source:
  <https://github.com/dchest/fast-sha256-js>.

## Tenant module UI starter

The Apache-2.0 `templates/tenant-module-nextjs` starter contains button, card,
and table source generated from the official shadcn/ui registry with CLI
`4.13.1`. shadcn/ui is MIT licensed; the upstream copyright, permission text,
reviewed registry-response digest, and source URL are preserved in the
starter's `THIRD_PARTY_NOTICES.md`. No Shadcn Studio source, registry alias,
credential, template, component, block, theme, MCP resource, or design asset is
included in the OpenTenant repository or release.

## Agent-pipeline research references

`docs/tooling/unattended-development.md` compares several open-source agentic
development projects as design references. OpenTenant did not copy or vendor
their code, prompts, workflow files, or assets, and did not add them as package
dependencies. Their names, links, star-count snapshot, and licence summaries
are provenance for pattern research only; each upstream licence still governs
any future decision to reuse its material. OpenHands is specifically recorded
as MIT outside `enterprise/` and PolyForm Free Trial 1.0.0 inside that subtree,
rather than relying on GitHub's indeterminate repository-level SPDX value.

This file records the source-tree review; it is not a substitute for including
the complete applicable licence texts, attributions, source offers, or
relinking material in a distributed container, binary, archive, or download.
Generate and verify those materials against each actual release artifact and
supported platform. See
`docs/legal/2026-07-20-technical-licence-provenance-review.md` for the complete
scope, evidence, findings, and remaining counsel gates.

## Browser test dependencies

- `@playwright/test`, `playwright`, and `playwright-core` at `1.61.1`:
  Apache-2.0, from <https://github.com/microsoft/playwright>. Packaged licence
  files remain in the installed dependencies. The browser harness uses their
  APIs and contains no copied upstream source.
- `undici@7.30.1`: MIT, from <https://github.com/nodejs/undici>. The test app uses
  its connector API to reach a synthetic HTTPS upstream on loopback.

## Credential envelopes and transactional email

- The credential envelope design references `@47ng/cloak` (MIT),
  <https://github.com/47ng/cloak>. Only the version/algorithm/key-routing
  envelope pattern is used. No upstream code is copied or vendored; the
  implementation extends OpenTenant's existing Node crypto boundary.
- Nodemailer `10.0.10` is an optional SMTP dependency under MIT-0. Source:
  <https://github.com/nodemailer/nodemailer>. Its packaged licence applies.
- React Email render `1.0.5` and the body, container, head, heading, html,
  preview and text components are MIT dependencies. Source:
  <https://github.com/resend/react-email>. Versions and integrity values are
  recorded in `pnpm-lock.yaml`; no dependency source is vendored here.
- The local development Mailpit image is MIT licensed. Source:
  <https://github.com/axllent/mailpit>. Compose pins `v1.27.8`.
## Wave 2 observability and rate limiting

The integrations use maintained dependencies rather than vendoring SDK source.
The exact versions and integrity hashes are recorded in `pnpm-lock.yaml`:
OpenTelemetry JavaScript and its pg instrumentation (Apache-2.0), `@vercel/otel`
(Apache-2.0), pino (MIT), `@sentry/nextjs` (MIT), and
`rate-limiter-flexible` (ISC). The Sentry SDK accepts any Sentry-protocol DSN;
no server product's source is copied into OpenTenant.

`tooling/migrations/sql/control-plane/0050_request_rate_limits.sql` adapts the
Postgres table schema from `RateLimiterPostgres._getCreateTableStmt` in
rate-limiter-flexible 11.4.1. Source:
<https://github.com/animir/node-rate-limiter-flexible/blob/9f744dca08d58b270c4c64593a3c92e56f2e8bfb/lib/RateLimiterPostgres.js>.
Commit: `9f744dca08d58b270c4c64593a3c92e56f2e8bfb`. Licence: ISC.
Copyright 2019 Roman Voloboev.

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

## Automated accessibility audit

- `@axe-core/playwright@4.11.0` and its locked `axe-core@4.11.4` dependency:
  MPL-2.0, from <https://github.com/dequelabs/axe-core-npm> and
  <https://github.com/dequelabs/axe-core>. Used through their public APIs in
  the development-only Playwright audit. No upstream source is copied or modified.
