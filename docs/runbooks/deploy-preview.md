# Hosted preview deployment

OpenTenant is local-first. Use this runbook only after the owner approves a
specific hosted test account, project, revision, region, and cost ceiling.
Vercel is the selected hosted deployment provider; no Vercel account or
project is canonical. Use the REST API, never the Vercel CLI.

Use the dry-run-first helper in [deploy.md](deploy.md#vercel-rest-preview) for
wildcard domain registration, preview environment-name checks and deployment
from a reviewed git revision. The application root is `apps/platform`; the
workspace build command is recorded in `vercel.json` and passed alongside the
root setting in the REST request. The curl below remains a manual reference.

## Required context

- CI is green for `RELEASE_SHA`.
- `VERCEL_API_KEY`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, and
  `GITHUB_REPO_ID` identify the approved test resources at runtime.
- `RELEASE_REF` and `RELEASE_SHA` identify the reviewed source.
- `EVIDENCE_DIR` is a new directory under `docs/architecture/evidence/`.
- The evidence directory must contain identifiers and results, never secrets.

## Select one identity provider

Every installation sets exactly one `IDENTITY_PROVIDER`: `workos` or `clerk`
for hosted previews (`local` is development-only). Never configure a fallback
between hosted providers in one deployment.

For WorkOS, provide the API/client/cookie/callback variables documented in
`.env.example`. For Clerk, provide the secret and publishable keys, the exact
Frontend API issuer, an allowlist of exact browser origins, and an explicit
session-token audience. Configure the same audience as a Clerk session claim;
the application denies a token whose audience, issuer, or authorized party
does not match.

Clerk deployments require Organizations plus these role mappings in the
active/default Role Set:

- `org:tenant_owner` -> `tenant_owner` (creator role)
- `org:tenant_admin` -> `tenant_admin`
- `org:member` -> `tenant_member` (default member role)

Optional module elevation is allowlisted explicitly, beginning with
`org:brain:promote` -> `brain.promote`. Unknown roles and permissions grant
nothing. Validate the Clerk plan's custom-role limits before selecting Clerk;
do not silently map Clerk's `org:admin` to an OpenTenant role. Additional Role
Sets require Clerk's Enhanced B2B Authentication add-on, while the Primary
Role Set can be modified without creating an additional set.

## Create and verify

Create a preview by omitting `target`:

```bash
jq -n '{
  name: env.VERCEL_PROJECT_NAME,
  project: env.VERCEL_PROJECT_ID,
  gitSource: {
    type: "github", repoId: env.GITHUB_REPO_ID,
    ref: env.RELEASE_REF, sha: env.RELEASE_SHA
  }
}' | curl --fail-with-body -sS -X POST \
  "https://api.vercel.com/v13/deployments?teamId=$VERCEL_TEAM_ID" \
  -H "Authorization: Bearer $VERCEL_API_KEY" \
  -H "Content-Type: application/json" --data-binary @- \
  | tee "$EVIDENCE_DIR/deployment-create.json"
```

Read the returned deployment ID and generated hostname from the saved response.
Poll the deployment API until `readyState` is `READY`; stop on `ERROR` or
`CANCELED`. Verify `/api/health`, `/assessment`, identity fail-closed behaviour,
tenant isolation, and a content-free telemetry event.

Record the source revision, provider account and project IDs, deployment ID,
region, environment-variable names and targets, migration state, checks,
exceptions, approver, and the exact rollback candidate. Never promote a preview
with missing evidence.
