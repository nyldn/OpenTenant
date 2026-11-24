import "server-only";
import type { Pool, PoolClient } from "pg";
import { controlPlanePool } from "./control-plane";

type Database = Pick<Pool, "query"> | Pick<PoolClient, "query">;
const ASSET_PREFIX = "/api/settings/branding/assets/";
export const PUBLIC_BRANDING_ASSETS = [{ url: "/opentenant-logo.svg", displayName: "OpenTenant · Public platform default" }] as const;
const assetId = (value: string) => /^asset_[a-zA-Z0-9_-]{1,100}$/.test(value);

/** The public list is explicit. No tenant names or private references are global. */
export async function tenantBrandingAssets(tenantId: string, database: Database = controlPlanePool()) {
  const { rows } = await database.query<{ asset_id: string; display_name: string }>(
    "select asset_id, display_name from tenant_branding_assets where tenant_id = $1 order by display_name, asset_id", [tenantId],
  );
  return [...PUBLIC_BRANDING_ASSETS, ...rows.map(row => ({ url: `${ASSET_PREFIX}${row.asset_id}`, displayName: row.display_name }))];
}

/** Validate ownership at mutation time, inside the brand transaction. */
export async function tenantOwnsBrandingAsset(tenantId: string, url: string, database: Database = controlPlanePool()): Promise<boolean> {
  if (url === "" || PUBLIC_BRANDING_ASSETS.some(asset => asset.url === url)) return true;
  if (!url.startsWith(ASSET_PREFIX)) return false;
  const id = url.slice(ASSET_PREFIX.length);
  if (!assetId(id)) return false;
  const { rows } = await database.query("select asset_id from tenant_branding_assets where tenant_id = $1 and asset_id = $2 for share", [tenantId, id]);
  return rows.length === 1;
}

export async function readTenantBrandingAsset(tenantId: string, id: string, database: Database = controlPlanePool()) {
  if (!assetId(id)) return null;
  const { rows } = await database.query<{ mime_type: string; content: Buffer }>(
    "select mime_type, content from tenant_branding_assets where tenant_id = $1 and asset_id = $2", [tenantId, id],
  );
  const row = rows[0];
  if (!row || !safeRaster(row.mime_type, row.content)) return null;
  return row;
}

function safeRaster(mime: string, content: Buffer): boolean {
  if (content.length < 12 || content.length > 1_048_576) return false;
  if (mime === "image/png") return content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg") return content[0] === 255 && content[1] === 216 && content[2] === 255;
  if (mime === "image/gif") return ["GIF87a", "GIF89a"].includes(content.subarray(0, 6).toString("ascii"));
  return mime === "image/webp" && content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP";
}
