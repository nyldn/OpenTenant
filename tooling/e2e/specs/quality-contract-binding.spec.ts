import { test, expect } from "@playwright/test";
import { qualityBindingJourney, qualityProofDatabase } from "../../../packages/database/src/quality-contract-store.proof";

// No host route or UI exists for E18. Exercise the production server-side store
// against the full canonical control-plane catalog, with no browser fixture.
test("artifact mismatch cannot bind quality evidence", async () => {
  test.setTimeout(120000);
  const url = process.env.QUALITY_CONTRACT_DATABASE_URL ?? process.env.CONTROL_PLANE_INTEGRATION_DATABASE_URL ?? process.env.CONTROL_PLANE_DATABASE_URL;
  if (!url) throw new Error("Quality binding journey requires pnpm db:ephemeral");
  const proof = await qualityProofDatabase(url);
  try {
    const result = await qualityBindingJourney(proof.pool);
    expect(result.evaluation.evidence_body).toMatchObject({ result: { verdict: "accepted" } });
  } finally { await proof.dispose(); }
});
