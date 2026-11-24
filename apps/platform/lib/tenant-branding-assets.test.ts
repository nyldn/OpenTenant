import { expect, it, vi } from "vitest";
import { readTenantBrandingAsset, tenantBrandingAssets, tenantOwnsBrandingAsset } from "./tenant-branding-assets";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", "base64");
it("lists only the selected tenant and explicitly public defaults", async () => {
  const query = vi.fn(async () => ({ rows: [{ asset_id: "asset_alpha", display_name: "Alpha logo" }] }));
  const assets = await tenantBrandingAssets("ten_alpha", { query } as never);
  expect(query).toHaveBeenCalledWith(expect.stringContaining("where tenant_id = $1"), ["ten_alpha"]);
  expect(assets.map(a => a.displayName).join(" ")).not.toContain("Example Organisation");
  expect(assets).toContainEqual({ url: "/api/settings/branding/assets/asset_alpha", displayName: "Alpha logo" });
});
it("checks ownership for private references rather than accepting path grammar", async () => {
  const query = vi.fn(async () => ({ rows: [] }));
  expect(await tenantOwnsBrandingAsset("ten_alpha", "/api/settings/branding/assets/asset_beta", { query } as never)).toBe(false);
  expect(query).toHaveBeenCalledWith(expect.stringContaining("for share"), ["ten_alpha", "asset_beta"]);
  expect(await tenantOwnsBrandingAsset("ten_alpha", "/example-tenant-logo.svg", { query } as never)).toBe(false);
  expect(await tenantOwnsBrandingAsset("ten_alpha", "https://example.test/logo.png", { query } as never)).toBe(false);
  expect(await tenantOwnsBrandingAsset("ten_alpha", "/opentenant-logo.svg", { query } as never)).toBe(true);
});
it("binds reads to the tenant and refuses active content and mismatched MIME", async () => {
  const query = vi.fn(async () => ({ rows: [{ mime_type: "image/png", content: png }] }));
  expect(await readTenantBrandingAsset("ten_alpha", "asset_alpha", { query } as never)).toEqual({ mime_type: "image/png", content: png });
  expect(query).toHaveBeenCalledWith(expect.stringContaining("tenant_id = $1 and asset_id = $2"), ["ten_alpha", "asset_alpha"]);
  query.mockResolvedValue({ rows: [{ mime_type: "image/png", content: Buffer.from("<svg onload='bad()'></svg>") }] });
  expect(await readTenantBrandingAsset("ten_alpha", "asset_alpha", { query } as never)).toBeNull();
  query.mockClear(); expect(await readTenantBrandingAsset("ten_alpha", "../asset_alpha", { query } as never)).toBeNull(); expect(query).not.toHaveBeenCalled();
});
