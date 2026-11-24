export const productionConfig = {
  NODE_ENV: "production", PROVISIONING_PROVIDER: "neon", IDENTITY_PROVIDER: "workos",
  CONTROL_PLANE_DATABASE_URL: "postgresql://user:synthetic@db.example.test/control",
  TENANT_DB_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  OPENTENANT_TENANT_BASE_DOMAIN: "tenants.example.test",
  MODULE_ACCESS_SECRET: "x".repeat(32), NEON_API_KEY: "synthetic", NEON_ORG_ID: "synthetic",
  CONNECTIONS_STATE_SECRET: "s".repeat(32),
  WORKOS_API_KEY: "synthetic", WORKOS_CLIENT_ID: "synthetic",
  WORKOS_COOKIE_PASSWORD: "x".repeat(32), WORKOS_REDIRECT_URI: "https://admin.example.test/auth/callback",
};
