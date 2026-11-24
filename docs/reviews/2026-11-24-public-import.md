# Clean import review, 2026-11-24

The contribution checkout starts from a reviewed source snapshot. Its first
commit has no parent. It excludes generated graph and visual-check output,
machine-local files, development endpoints, and internal agent handoffs.
Historical accessibility remap manifests stay with the development archive.
The reviewed accessibility baseline is part of the import.

The workspace keeps local environment settings, scratch files, and
verification receipts outside version control. The Git hooks and the
Repository privacy CI job scan Git content with Gitleaks. An isolated local
proof confirmed that the hooks reject force-added workspace files, a
synthetic secret removed in a later commit, and a synthetic secret in a
commit message. A separate proof covered the optional local marker list.

Follow the [workspace guide](../tooling/local-workspace.md) to reproduce the
Git checks. The scans cover their configured patterns. Source and fixture
provenance, tenant data, and asset licensing need maintainer review.

The existing private development repository has pull request refs and Actions
records. Publish the import to a fresh repository after the [owner
tasks](../OWNER-TASKS.md#before-making-the-repository-public) are complete.
