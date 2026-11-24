# Local developer workspace

Use Node 22, the pnpm version pinned in `package.json`, and Gitleaks 8.30.1.
From the repository root, create the local workspace and enable Git hooks.

```sh
umask 077
mkdir -p .local/workspace .local/evidence
test -f .env || cp .env.example .env
git config --local core.hooksPath .githooks
git check-ignore .env .local/workspace
```

Follow [the quick start](../../README.md#run-it-locally) for PostgreSQL and the
application. Keep scratch files and machine-specific setup in
`.local/workspace/`, and put local logs and test evidence in
`.local/evidence/`. Use the ignored root `.env` for local settings.
Keep `.env.example` synthetic. Use only synthetic accounts and data.

The pre-commit hook scans staged content and blocks local workspace paths,
credential files, exports, and generated artifacts even if they were
force-added. The pre-push hook checks the commits Git is sending, including
secrets added and then removed and secrets in commit messages. CI runs the
same history check on pull requests. Run the checks directly when reviewing a change.

```sh
node tooling/ci/repository-privacy.mjs --staged
node tooling/ci/repository-privacy.mjs --history
```

For known private identifiers, put one literal per line in
`.local/private-markers.txt`. The hooks check these locally with redacted
output. Use a secret manager for credentials.

Review docs, fixtures, assets, commit messages, and PR uploads for private
identifiers and customer data. Use reserved example domains, synthetic IDs,
and authored or properly licensed assets. Keep browser recordings, database
exports, provider responses, and agent transcripts in the local workspace.

Maintainers should require the **Repository privacy** status check and review
of changes to the workflow, hooks, scanner configuration, and ignore rules.
Enable secret scanning and push protection on the contribution repository.
If a credential was committed, revoke or rotate it and report the incident
privately. Coordinate cleanup of every affected ref and copy.

Use a fresh remote for the clean import. The development archive contains
historical pull request refs and Actions records. Keep it private and use
reviewed patches when porting work from it.
