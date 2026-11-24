# OpenTenant licensing

OpenTenant uses a deliberately split licence model. A more specific licence in
a subdirectory overrides the repository-root licence for material in that
subdirectory.

## Core platform

Except where stated below, the software in this repository is licensed under
the GNU Affero General Public License, version 3 only
(`AGPL-3.0-only`). The complete terms are in `LICENSE`.

This includes the platform application, native example modules, control-plane
and tenant-plane packages, sandbox orchestration, migrations, provisioning,
tests, and build tooling.

The AGPL permits commercial and internal use. If a modified version supports
remote network interaction, section 13 requires it to offer its Corresponding
Source to users interacting with it remotely.

## Module SDK and tenant UI starter

`packages/module-sdk` and `templates/tenant-module-nextjs` are licensed under
the Apache License 2.0. Complete terms are included in each directory.

This exception lets tenant developers implement remote modules against the
OpenTenant contract and begin from the supported UI baseline without requiring
those independent modules to use the AGPL merely because they use the SDK or
starter. Whether a particular combined or derivative work is covered remains a
fact-specific legal question. Third-party shadcn/ui source inside the starter
retains its MIT notice in the starter's `THIRD_PARTY_NOTICES.md`.

## Documentation

Material under `docs/` is licensed under Creative Commons
Attribution-ShareAlike 4.0 International (`CC-BY-SA-4.0`). Its complete terms
are in `docs/LICENSE`.

Source code embedded in documentation remains under the licence that applies
to that source code unless the document states otherwise.

## Generated repository graph

`graphify-out/GRAPH_REPORT.md` is generated documentation licensed under
`CC-BY-SA-4.0`. The graph structure, build metadata, and relationships in
`graphify-out/graph.json` are licensed under `AGPL-3.0-only` to the extent they
are independently copyrightable.

Source names, signatures, headings, and other material indexed into either
artifact retain the licence of their originating source file. Generating the
index does not relicense that source material or grant additional rights in
third-party material.

## Tenant material and third-party software

These licences do not claim ownership of tenant data, tenant content, or
independently developed remote modules. Third-party software, assets, and
dependencies remain governed by their respective licences and notices.

No rights to the OpenTenant name, logos, or other brand identifiers are
granted by the software or documentation licences. See `TRADEMARKS.md`.

## Commercial licensing

The OpenTenant core is intended to be available under separately negotiated
commercial terms for organisations that do not want to comply with the AGPL.
`COMMERCIAL-LICENSE.md` explains the current boundary. No commercial licence
is granted automatically.

This repository is not accepting external code contributions until the legal
project steward and contributor agreement are approved. See `CONTRIBUTING.md`.
