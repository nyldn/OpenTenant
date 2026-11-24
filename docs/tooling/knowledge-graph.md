# Repository knowledge graph

OpenTenant uses [Graphify](https://github.com/Graphify-Labs/graphify) as its
local repository knowledge-graph helper. It maps TypeScript, SQL, Markdown,
and repository relationships into a queryable graph without introducing a
runtime dependency in the OpenTenant product.

The local tool is Graphify 0.9.20 with its SQL parser extra. It is installed as
an isolated `uv` tool rather than as a monorepo package dependency.

## Why Graphify

The July 2026 review considered four current approaches:

| Tool | Strength | Reason not selected as the primary helper |
|---|---|---|
| Graphify | Mixed code and documentation graph, local code extraction, Codex support, MIT licence | Selected |
| [GitNexus](https://github.com/nxpatterns/gitnexus) | Deep code call chains, execution flows, and MCP tools | PolyForm Noncommercial terms are a poor default for a repository intended for an undecided commercial model |
| [CodeGraphContext](https://github.com/CodeGraphContext/CodeGraphContext) | Broad language support, live watching, and multiple graph databases | Adds a database-backed service and more operational state than this repository needs |
| [SCIP](https://github.com/scip-code/scip) | Precise, language-neutral code-intelligence interchange | A protocol and index format, not a complete mixed-corpus knowledge workflow |

## Privacy boundary

Code structure is extracted locally. Semantic extraction of Markdown or other
documents may use a configured model backend. Never allow Graphify to ingest
`.env`, credentials, caches, logs, generated output, or genuine tenant data.
Use an explicitly approved backend when document residency matters.

## Build and refresh

From the repository root:

```bash
graphify extract . --code-only
graphify cluster-only . --no-label --no-viz
graphify check-update .
graphify update .
```

The local build processes TypeScript, JavaScript, JSON, shell, SQL, and
Markdown structure locally with no model or API cost. Document headings and
containment appear in the graph, while deeper semantic relationship inference
and community naming require an explicitly approved local or hosted model
backend.

Use `extract` for the initial graph, `cluster-only` to generate the report
without LLM labels, `check-update` to inspect freshness, and `update` after
material code changes. Do not use `--force` unless a normal update is
demonstrably stale.

The generated `Built from commit` value records the checked-out commit at
extraction time; it is not a clean-tree hash. A graph generated while source
files are dirty can contain content absent from that commit. Conversely, a
separate commit containing only refreshed graph artifacts will put `HEAD` one
commit ahead without making the indexed source stale. Use `graphify
check-update .` together with `git status --short`, and regenerate from a clean
source checkpoint whenever reproducible graph provenance is required.

## Query workflow

1. Read `graphify-out/GRAPH_REPORT.md`.
2. Check freshness with `graphify check-update .`.
3. Use `graphify query`, `graphify path`, or `graphify explain` for
   relationships.
4. Read source files for exact behavior and line-level evidence.

Examples:

```bash
graphify query "How does tenant resolution constrain database access?"
graphify path "IdentityGateway" "audit chain"
graphify explain "SandboxAdapter"
```

Graph data, reports, caches, and query state stay in the ignored
`graphify-out/` directory.

The generated report is `CC-BY-SA-4.0`; the graph structure and relationships
are `AGPL-3.0-only`. Indexed source fragments retain their originating
licences. See `LICENSING.md` for the complete boundary.

## Local integration

Run these on each development machine:

```bash
uv tool install --force "graphifyy[sql]"
graphify install
graphify codex install
```

The Codex hook and Git hook configuration contain machine-local executable
paths and are intentionally not committed. `AGENTS.md`, `.gitattributes`, and `.graphifyignore` define the shared setup.
