## Summary

<!-- Explain the user or platform outcome, not only the files changed. -->

## Verification

<!-- List exact commands and runtime evidence. Mark anything not verified. -->

Follow the repository's [delivery contract](../docs/DELIVERY.md) for the checks
required by this change type.

## Security and tenancy

<!-- Describe tenant binding, authorization, data, secrets, and provider-boundary impact. Write "No change" when none applies. -->

## Documentation

<!-- Link updated durable records or explain why no documentation changed. -->

## Checklist

- [ ] The change is scoped to an established requirement.
- [ ] Tests cover new or corrected observable behavior where applicable.
- [ ] Tenant-sensitive behavior fails closed on ambiguity.
- [ ] No secret, customer data, account identifier, or provider response is exposed.
- [ ] Provider-specific SDKs remain inside adapter or composition boundaries.
- [ ] Relevant checks and `git diff --check` pass.
- [ ] README, changelog, handoff, ship log, owner tasks, and Graphify are current where their facts changed.
- [ ] The repository privacy check passes. All fixtures and evidence are synthetic.
