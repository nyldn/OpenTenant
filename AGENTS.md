@RTK.md

## Browser automation

- Use the `browseros` MCP server through BrowserOS Neo as the default browser
  interface for research, navigation, forms, uploads, and application testing.
- Work in a named, agent-owned tab. Preserve the user's existing tabs and
  authenticated sessions, and refresh element references after navigation.
- Use `agent-browser` only when BrowserOS Neo is unavailable or the task
  explicitly needs a disposable isolated session. Close fallback sessions when
  the task is complete.

## graphify

Generate and query the local knowledge graph in ignored `graphify-out/`.

When the user asks for Graphify or repository-graph work, use the installed
Graphify skill or these instructions before doing anything else. In Codex, the
chat-facing skill name is `$graphify`; shell commands use `graphify`.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Check graph freshness when results depend on recent changes.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Parallel agent rules

These rules apply to every implementation agent that works in a separate
worktree. They answer the questions agents most often stop to ask.

- **Database for tests.** Use `pnpm db:ephemeral -- <command>` with the CI
  image `pgvector/pgvector:0.8.2-pg17-bookworm`. See
  [the database guide](docs/tooling/db-ephemeral.md). The harness uses a unique
  container, a random loopback host port other than 5432, and automatic cleanup.
  A proof that skips because pgvector is missing is a failed proof, not a pass.
- **Migrations.** Reserve numbers in `docs/plans/migration-reservations.md`
  before writing SQL. Add forward migrations only.
- **Dependencies.** Downloading packages from the public npm registry is
  allowed for the packages a task needs. Pin exact versions, commit the
  lockfile, and keep `pnpm audit --prod --audit-level high` at zero. Do not
  contact any other host.
- **Generated graph.** Keep `graphify-out/` local.
- **Logs.** `docs/SHIPLOG.md` and `CHANGELOG.md` merge with the union
  strategy. Add a new dated entry at the top. Never rewrite an existing entry.
- **Ownership.** Edit only the paths your task assigns. If a fix needs a file
  you do not own, export a helper and list the wiring in your final report, so
  the integrator can connect it.
- **Code reuse.** Follow the reuse policy in
  `docs/plans/2026-11-11-engineering-score.md`.
