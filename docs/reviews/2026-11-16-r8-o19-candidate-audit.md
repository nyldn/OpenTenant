# R8 O19 candidate history and artifact audit preparation

Base: `41adc71`. Marketing impact: none. Public release remains owner gated.

The reproducible local audit is `tooling/build/audit-candidate.mjs`.
After the candidate is committed and autosquashed, run these commands serially
inside the required foreground `forge-job run` wrapper:

```sh
pnpm package:check
node tooling/build/audit-candidate.mjs --candidate HEAD \
  --evidence dist/release-evidence/evidence.json \
  --output dist/release-evidence/candidate-audit.json
```

The package check currently exits 1 on three unattributed copied-code files
across two packages. It still writes the complete private preparation inventory.
That nonzero result is a release blocker, not a reason to omit the audit.
The final generated audit report binds its counts to the exact candidate SHA,
23 package archives and their corresponding-source archive. Rerun after any
commit, rebase, rebuild, repack or artifact-list change. Never publish a failed
or stale preparation set.

The audit walks every object reachable from the selected candidate, including
deleted historical files. It screens blob contents, commit messages and
identity metadata, sensitive historical path names, and packed artifact bytes.
It verifies the complete public-package inventory, archive SHA-512 values and
source revision before scanning. A source/candidate mismatch, duplicate/missing
artifact, digest mismatch, unsafe tar member or scanner failure fails closed.
Shallow history cannot qualify. No checkout or history rewriting is performed.

Secret screens include private keys, credential-bearing connection URIs and
provider-token patterns. Identifier screens include local home paths,
non-reserved email addresses and deployment/provider endpoint URLs. Tenant-data
screens include database dump markers and row/payload patterns. Security
screens include disabled TLS verification, privileged roles and disabled RLS.
Installed Gitleaks scans candidate history using the repository policy. Its
stdout/stderr and temporary redacted report are never forwarded; only the
finding count is retained. All exported reports contain aggregate counts,
never matching values, file names, source snippets, authors or commit subjects.

The screens deliberately include fixtures, public dependency copyright data
and documentation. Counts are review queues, not confirmed leaks. Every finding
requires classification; zero pattern matches would still require owner review.
Binary data needs a format-specific review. These checks cannot attest the
absence of semantic tenant data, unmarked copied source or architectural
security defects. The required database/RLS and static test evidence is
recorded separately. Hosted PRs, issues, CI records, unrelated refs and
unbuilt distribution targets are outside this candidate-only scan.

Two audit regression tests passed. A synthetic secret is removed in a later
commit, and the history scan still detects it without returning its value.
Tests also cover packed security patterns, source revision binding and archive
integrity rejection. The complete eight-case new-tool proof and owned-file
ESLint passed. The execution receipt at `dist/release-evidence/candidate-audit.json`
is generated after the final commits so its SHA can be checked against HEAD.
The local preparation result remains blocked by provenance and history screens;
this receipt supplies no visibility-change or publication approval.

Integrator wiring: optionally add `release:audit` with
`node tooling/build/audit-candidate.mjs`. No package manifest or lockfile was
edited here. Preserve the exact packed artifacts, source archive, evidence
inventory and generated count-only audit together for owner review.

Owner steps still required: classify every history/artifact finding, resolve
copied-code provenance and pre-import authorship/assignment, review security
boundaries and unsupported artifact targets, approve the final legal material,
and explicitly approve any public release. No publish, push, hosted review or
live provider operation was performed.
