// Expected Vitest suite counters and case counts, reviewed against collected
// names and live JSON receipts. Files are exact repository-relative paths.
export const SEQUENCE_COUNTS = {
  "custom-domains": {
    "suites": 3,
    "files": {
      "apps/platform/lib/custom-domains.integration.test.ts": 16
    }
  },
  "authorization-outbox": {
    "suites": 2,
    "files": {
      "apps/platform/lib/authz-outbox.integration.test.ts": 10
    }
  },
  "provisioning-neon": {
    "suites": 2,
    "files": {
      "apps/platform/lib/provisioning.integration.test.ts": 1
    }
  },
  "provisioning-postgres": {
    "suites": 2,
    "files": {
      "apps/platform/lib/provisioning-postgres.integration.test.ts": 2
    }
  },
  "identity": {
    "suites": 7,
    "files": {
      "packages/testing/src/better-auth.integration.test.ts": 26,
      "packages/testing/src/identity-adapters.test.ts": 39
    }
  },
  "worker": {
    "suites": 4,
    "files": {
      "apps/platform/lib/tenant-lifecycle.integration.test.ts": 4,
      "apps/platform/lib/tenant-worker.integration.test.ts": 9
    }
  },
  "support-delivery": {
    "suites": 2,
    "files": {
      "modules/support/src/delivery.integration.test.ts": 8
    }
  },
  "support-ai-review": {
    "suites": 2,
    "files": {
      "modules/support/src/support-ai-review.integration.test.ts": 17
    }
  },
  "tenant-export": {
    "suites": 2,
    "files": {
      "apps/platform/lib/tenant-export.integration.test.ts": 3
    }
  },
  "usage-export": {
    "suites": 2,
    "files": {
      "packages/usage-export/src/job.integration.test.ts": 6
    }
  },
  "key-rotation": {
    "suites": 2,
    "files": {
      "packages/database/src/credential-cipher-rotation.postgres.test.ts": 2
    }
  },
  "rate-limit": {
    "suites": 2,
    "files": {
      "apps/platform/lib/rate-limit.integration.test.ts": 3
    }
  },
  "pg-observability": {
    "suites": 2,
    "files": {
      "packages/observability/src/pg.integration.test.ts": 1
    }
  },
  "migrations": {
    "suites": 33,
    "files": {
      "tooling/migrations/src/audit-truncate.integration.test.ts": 22,
      "tooling/migrations/src/control-plane-admission.integration.test.ts": 2,
      "tooling/migrations/src/control-plane-authorization.integration.test.ts": 2,
      "tooling/migrations/src/control-plane-brand-upload.integration.test.ts": 29,
      "tooling/migrations/src/control-plane-meaning-bearing-bans.integration.test.ts": 6,
      "tooling/migrations/src/control-plane-model-routing-store.integration.test.ts": 8,
      "tooling/migrations/src/control-plane-model-routing.integration.test.ts": 17,
      "tooling/migrations/src/control-plane-module-capabilities.integration.test.ts": 3,
      "tooling/migrations/src/control-plane-module-ownership.integration.test.ts": 1,
      "tooling/migrations/src/control-plane-usage-ledger.integration.test.ts": 2,
      "tooling/migrations/src/control-plane-voice-profile.integration.test.ts": 7,
      "tooling/migrations/src/hosted.integration.test.ts": 2,
      "tooling/migrations/src/local.integration.test.ts": 4,
      "tooling/migrations/src/module-installation.integration.test.ts": 1,
      "tooling/migrations/src/tenant-core.integration.test.ts": 12,
      "tooling/migrations/src/tenant-support-outbox.integration.test.ts": 11
    }
  },
  "developer-mcp": {
    "suites": 6,
    "files": {
      "packages/developer-mcp/src/brain.integration.test.ts": 6,
      "packages/developer-mcp/src/oauth.integration.test.ts": 5,
      "packages/developer-mcp/src/runtime.integration.test.ts": 12
    }
  },
  "isolation-fuzz": {
    "suites": 2,
    "files": {
      "packages/testing/src/isolation-fuzz.test.ts": 9
    }
  }
};
