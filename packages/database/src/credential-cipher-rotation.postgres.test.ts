import { createCipheriv, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CredentialCipher } from "./credential-cipher";
import { rotateCredentials } from "./credential-cipher-rotation";
import { PgAuditStore } from "./audit-store";

const url = process.env.KEY_ROTATION_DATABASE_URL;
if (
  url &&
  (!["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
    !new URL(url).pathname.startsWith("/opentenant_it_"))
) {
  throw new Error(
    "Key rotation proof requires a dedicated local opentenant_it_ database",
  );
}
const old = new CredentialCipher(Buffer.alloc(32, 9).toString("base64"));
const cipher = CredentialCipher.fromEnv({
  TENANT_DB_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  TENANT_DB_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 8).toString("base64")}`,
  TENANT_DB_ENCRYPTION_ACTIVE_KEY_ID: "k1",
});
function legacyCredential() {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.alloc(32, 9), iv);
  cipher.setAAD(Buffer.from("tenant_rotation"));
  return Buffer.concat([
    iv,
    cipher.update("synthetic-db-uri"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}
const options = {
  mode: "apply" as const,
  actorId: "operator_test",
  batchSize: 2,
};

describe.skipIf(!url)(
  "credential rotation with real Postgres (set KEY_ROTATION_DATABASE_URL)",
  () => {
    const pool = new Pool({ connectionString: url, max: 3 });
    beforeAll(async () => {
      await pool.query("drop schema if exists developer_mcp cascade; drop schema public cascade; create schema public");
      const dir = new URL(
        "../../../tooling/migrations/sql/control-plane/",
        import.meta.url,
      );
      for (const file of (await readdir(dir))
        .filter((f) => f.endsWith(".sql"))
        .sort()) {
        await pool.query(await readFile(new URL(file, dir), "utf8"));
      }
      await pool.query(`insert into tenants (tenant_id, slug, display_name, status, data_region)
      values ('tenant_rotation', 'rotation', 'Rotation proof', 'active', 'eu')`);
      await pool.query(
        `insert into tenant_databases (tenant_id, region, encrypted_connection) values ($1, 'eu', $2)`,
        ["tenant_rotation", Buffer.from(legacyCredential())],
      );
      await pool.query(
        `insert into oauth_token_vault (tenant_id, provider, encrypted_access_token, encrypted_refresh_token, aad)
      values ($1, 'google', $2, $3, $4)`,
        [
          "tenant_rotation",
          old.encrypt("synthetic-access", "oauth:tenant_rotation:google"),
          old.encrypt("synthetic-refresh", "oauth:tenant_rotation:google"),
          "oauth:tenant_rotation:google",
        ],
      );
      for (const tenant of [null, "tenant_rotation"]) {
        await pool.query(
          `insert into model_provider_credentials (tenant_id, provider, encrypted_credential, updated_by) values ($1, 'synthetic', $2, 'operator_test')`,
          [
            tenant,
            Buffer.from(
              old.encrypt(
                "synthetic-model",
                `model:${tenant ?? "installation"}:synthetic`,
              ),
            ),
          ],
        );
      }
    });
    afterAll(async () => {
      await pool.end();
    });

    it("dry-runs, interrupts, resumes, audits and preserves every credential", async () => {
      const dry = await rotateCredentials(pool, cipher, {
        ...options,
        mode: "dry-run",
      });
      expect(dry).toMatchObject({
        status: "completed",
        scanned: 5,
        rotated: 5,
      });
      const unchanged = await pool.query(
        "select encrypted_connection from tenant_databases",
      );
      expect(
        old.decrypt(
          unchanged.rows[0].encrypted_connection.toString("utf8"),
          "tenant_rotation",
        ),
      ).toBe("synthetic-db-uri");
      expect(
        unchanged.rows[0].encrypted_connection.toString("utf8"),
      ).not.toContain("v1.");
      const first = await rotateCredentials(pool, cipher, {
        ...options,
        maxBatches: 1,
      });
      expect(first).toMatchObject({
        status: "running",
        scanned: 2,
        rotated: 2,
      });
      const resumed = await rotateCredentials(pool, cipher, {
        ...options,
        runId: first.runId,
      });
      expect(resumed).toMatchObject({
        status: "completed",
        scanned: 5,
        rotated: 5,
      });
      expect(
        await rotateCredentials(pool, cipher, {
          ...options,
          runId: first.runId,
        }),
      ).toEqual(resumed);
      const db = await pool.query(
        "select encrypted_connection from tenant_databases",
      );
      expect(
        cipher.decrypt(
          db.rows[0].encrypted_connection.toString("utf8"),
          "tenant_rotation",
        ),
      ).toBe("synthetic-db-uri");
      const oauth = (await pool.query("select * from oauth_token_vault"))
        .rows[0];
      expect(cipher.decrypt(oauth.encrypted_access_token, oauth.aad)).toBe(
        "synthetic-access",
      );
      expect(cipher.decrypt(oauth.encrypted_refresh_token, oauth.aad)).toBe(
        "synthetic-refresh",
      );
      for (const row of (
        await pool.query("select * from model_provider_credentials")
      ).rows) {
        expect(row.encrypted_credential.toString("utf8")).toContain(".k1.");
        expect(
          cipher.decrypt(
            row.encrypted_credential.toString("utf8"),
            `model:${row.tenant_id ?? "installation"}:${row.provider}`,
          ),
        ).toBe("synthetic-model");
      }
      expect((await rotateCredentials(pool, cipher, options)).rotated).toBe(0);
      const events = (
        await pool.query(
          "select * from audit_events where action like 'credentials.rotation.%'",
        )
      ).rows;
      expect(
        events.some((e) => e.action === "credentials.rotation.resumed"),
      ).toBe(true);
      expect(JSON.stringify(events)).not.toContain("synthetic-access");
      expect((await new PgAuditStore(pool).verifyChain(null)).intact).toBe(
        true,
      );
      await expect(
        rotateCredentials(pool, old, { ...options, runId: first.runId }),
      ).rejects.toThrow("rotation configuration mismatch");
    });

    it("rolls back a failed batch including its checkpoint and safe audit", async () => {
      await pool.query(
        `update tenant_databases set encrypted_connection = $1`,
        [Buffer.from(old.encrypt("synthetic-db-uri", "wrong-tenant"))],
      );
      await expect(rotateCredentials(pool, cipher, options)).rejects.toThrow(
        "credential rotation failed",
      );
      const run = (
        await pool.query(
          "select * from credential_rotation_runs order by created_at desc limit 1",
        )
      ).rows[0];
      expect(run.scanned).toBe(0);
      await pool.query(
        `update tenant_databases set encrypted_connection = $1`,
        [Buffer.from(old.encrypt("synthetic-db-uri", "tenant_rotation"))],
      );
      expect(
        await rotateCredentials(pool, cipher, {
          ...options,
          runId: run.run_id,
        }),
      ).toMatchObject({ status: "completed", scanned: 5, rotated: 1 });
    });
  },
);
