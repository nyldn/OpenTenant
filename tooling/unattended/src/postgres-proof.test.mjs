import assert from "node:assert/strict";
import test from "node:test";
import { buildPostgresProofEnvironment, validateRestrictedRoleAttributes } from "./postgres-proof.mjs";

test("proof child environment is an allow list and never inherits credentials", () => {
  const environment = buildPostgresProofEnvironment(
    {
      HOME: "/proof/home",
      PATH: "/runtime/bin",
      TMPDIR: "/proof/home/tmp",
      TERM: "dumb",
      CI: "1",
      GH_TOKEN: "secret",
      DATABASE_URL: "secret",
      NODE_OPTIONS: "--require=/tmp/evil.cjs",
      PGPASSWORD: "admin-secret",
    },
    {
      profile: "smoke",
      socketDirectory: "/private/tmp/otp/socket",
      port: 55439,
      restrictedRole: "opentenant_proof",
      password: "ephemeral-only",
    },
  );
  assert.deepEqual(Object.keys(environment).sort(), [
    "CI",
    "HOME",
    "OPENTENANT_POSTGRES_PROOF_PORT",
    "OPENTENANT_POSTGRES_PROOF_PROFILE",
    "OPENTENANT_POSTGRES_PROOF_ROLE",
    "OPENTENANT_POSTGRES_PROOF_SOCKET_DIRECTORY",
    "PATH",
    "PGPASSWORD",
    "TERM",
    "TMPDIR",
  ]);
  assert.equal(environment.GH_TOKEN, undefined);
  assert.equal(environment.PGPASSWORD, "ephemeral-only");
});

test("requires a fully restricted proof role", () => {
  const restricted = {
    rolcanlogin: true,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false,
    rolconnlimit: 12,
  };
  assert.doesNotThrow(() => validateRestrictedRoleAttributes(restricted));
  assert.throws(
    () => validateRestrictedRoleAttributes({ ...restricted, rolsuper: true }),
    /restricted role/u,
  );
});
