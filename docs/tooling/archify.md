# Archify diagrams

OpenTenant keeps Archify as a project-local Codex skill in
`.agents/skills/archify`. It is a development tool, not an application
dependency. The install record in `skills-lock.json` keeps the selected skill
content reviewable and makes a clean checkout easy to restore.
Graphify excludes `.agents/`, so the vendored renderer does not become part of
OpenTenant's repository map.

## First check

Run this from the repository root:

```sh
fnm exec --using=22 -- pnpm archify:doctor
```

The check should end with `Archify is ready.` It verifies the bundled renderer,
schemas, preview and visual-check runtimes, and the supported diagram types.

## Use it in Codex

Ask directly in the project chat. For the first OpenTenant map, use a prompt
like this:

```text
Use Archify to map OpenTenant's current runtime architecture from the checked-out source.
Show 8–12 core components, one primary request path, external dependencies,
tenant and trust boundaries, and the evidence revision. Keep supporting detail
in cards. Do not infer production infrastructure or provider activation.
```

Archify should create a typed JSON source first, then validate it and deliver a
self-contained HTML artifact. Keep committed sources under
`docs/architecture/archify/` and put the matching HTML beside its JSON source
when the artifact is worth sharing. Use synthetic or current repository facts,
not credentials, tenant data, or live infrastructure claims.

## Useful commands

The package scripts keep the installed path in one place:

```sh
fnm exec --using=22 -- pnpm archify:guide -- "Show tenant resolution and the database request path" --json
fnm exec --using=22 -- pnpm archify:validate -- architecture docs/architecture/archify/open-tenant.json --quality showcase --repo-root . --json
fnm exec --using=22 -- pnpm archify:deliver -- architecture docs/architecture/archify/open-tenant.json docs/architecture/archify/open-tenant.html --quality showcase --repo-root . --json
fnm exec --using=22 -- node .agents/skills/archify/bin/archify.mjs visual-check docs/architecture/archify/open-tenant.html --json
```

`validate` checks the JSON and composition. `deliver` is the final deterministic
artifact check and atomically writes the HTML. `visual-check` measures the
delivered HTML in a browser. It does not replace human visual review.

For a new artifact, use `architecture` for components and boundaries,
`workflow` for approvals or CI, `sequence` for one interaction, `dataflow`
for lineage, and `lifecycle` for states, retries, and terminal outcomes. Keep
the first map to one clear main path and at most 12 primary nodes.

## Worked example

The [OpenTenant runtime specification](../architecture/archify/open-tenant-runtime.architecture.json)
maps the request path, module boundary, and evidence path. Run the
`validate` and `deliver` commands above using this specification and open the
generated HTML in a browser. Keep rendered HTML, screenshots, and visual
receipts local.


## Updating or restoring the skill

OpenTenant opts into a guarded macOS updater. Install it once from the
repository root:

```sh
fnm exec --using=22 -- pnpm archify:install-updater
```

The LaunchAgent runs at login and once every seven days. It updates only the
Archify skill and `skills-lock.json`, runs `doctor`, and creates a local commit.
It never pushes. If the checkout has uncommitted OpenTenant source,
documentation, or configuration, or is not on `main`, it records a skip and
leaves the worktree alone. The repository's generated-only `graphify-out/`
diff is allowed. Logs are under
`~/Library/Logs/OpenTenant/archify-update.log`.

Run the same guarded update immediately with:

```sh
fnm exec --using=22 -- pnpm archify:update
```

Remove the LaunchAgent with:

```sh
fnm exec --using=22 -- pnpm archify:remove-updater
```

The checked skill remains the known working copy until an update passes these
guards. When an intentional manual update is needed, use:

```sh
npx --yes skills@1.7.0 update archify --project --yes
git diff -- .agents/skills/archify skills-lock.json
fnm exec --using=22 -- pnpm archify:doctor
```

To restore the project-local skill from the lock record on a fresh checkout:

```sh
npx --yes skills experimental_install -y
```

Review the skill diff before committing an update. Archify's upstream package
is MIT-licensed and includes its own third-party notices. The installed
revision is currently the development release recorded in
`.agents/skills/archify/skill-release.json`; the project lock records the
content hash. A skill update changes only this development tool and does not
change the OpenTenant runtime or deploy anything.
