# Hosted deployment rollback

This procedure reassigns deployment aliases. It does not rebuild code, reverse
database migrations, or alter DNS. Use it only for the explicitly approved
provider account and project.

## Preconditions

- The incident or release lead approves rollback.
- `ROLLBACK_DEPLOYMENT_ID` comes from release evidence, not list position.
- `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, and every `PRODUCTION_ALIAS` are exact
  runtime values for the approved environment.
- The rollback candidate is `READY`, belongs to that project, and has the
  expected source revision and environment contract.
- The current deployment, alias inventory, timestamps, and logs are preserved.

For each recorded alias, call the provider alias API against
`ROLLBACK_DEPLOYMENT_ID` and retain the response, including the displaced
deployment ID. Never modify an alias or domain that is absent from the approved
inventory.

Verify `/api/health`, `/assessment`, a content-free telemetry event, sign-in and
sign-out, tenant entitlements, and tenant isolation. Confirm that no incompatible
migration or credential change prevents the prior build from running.

Record the trigger, approver, start and end time, current and rollback
deployment IDs, every alias response, verification results, user impact, and
follow-up owner. Keep the failed deployment and logs until incident review.
