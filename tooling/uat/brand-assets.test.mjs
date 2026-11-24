import assert from "node:assert/strict";
import { test } from "node:test";
import { fixturePng, privateBrandAssets, seedPrivateBrandAssets } from "./brand-assets.mjs";

test("seed writes two stable private raster fixtures through the product asset store", async () => {
  const calls = [];
  await seedPrivateBrandAssets({ query: async (...args) => { calls.push(args); } });
  assert.equal(calls.length, 2);
  assert.deepEqual(privateBrandAssets.map(a => a.tenantId), ["tenant_e2e_alpha", "tenant_e2e_beta"]);
  assert.equal(new Set(privateBrandAssets.map(a => a.id)).size, 2);
  calls.forEach(([sql, params], index) => {
    assert.match(sql, /insert into tenant_branding_assets/);
    assert.deepEqual(params, [privateBrandAssets[index].id, privateBrandAssets[index].tenantId, privateBrandAssets[index].name, fixturePng]);
    assert.equal(fixturePng.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  });
});
