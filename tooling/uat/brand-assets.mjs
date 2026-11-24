// Synthetic one-pixel PNGs stored in the product's private, tenant-bound store.
export const FIXTURE_VERSION = 2;
export const privateBrandAssets = [
  { id: "asset_uat_alpha", tenantId: "tenant_e2e_alpha", name: "Alpha private logo" },
  { id: "asset_uat_beta", tenantId: "tenant_e2e_beta", name: "Beta confidential logo" },
];
export const fixturePng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", "base64");
export async function seedPrivateBrandAssets(db) {
  for (const asset of privateBrandAssets) {
    await db.query("insert into tenant_branding_assets(asset_id,tenant_id,display_name,mime_type,content) values ($1,$2,$3,'image/png',$4)", [asset.id, asset.tenantId, asset.name, fixturePng]);
  }
}
