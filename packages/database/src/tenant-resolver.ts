/**
 * Host-to-tenant resolution against the control-plane domains table
 * (architecture spec section 7 steps 2-4). Results are cached briefly;
 * unknown hosts cache too, so repeated probes of nonsense hosts do not
 * reach the database.
 */
import type { Pool } from "pg";

export interface ResolvedTenant {
  tenantId: string;
  slug: string;
  displayName: string;
  status: string;
}

interface CacheEntry {
  value: ResolvedTenant | null;
  expiresAt: number;
}

// Accepted tradeoff (review 2026-07-16): spec section 7 allows cached
// control-plane lookups; a suspended tenant or removed domain may serve for
// up to this window. Event-driven invalidation arrives with platform admin.
const CACHE_TTL_MS = 30_000;
// Hosts come from unauthenticated requests, and misses are cached on
// purpose, so the cache must be bounded or random Host headers grow it
// until the process runs out of memory. Map preserves insertion order, so
// the first key is the oldest entry.
const MAX_CACHE_ENTRIES = 5_000;

export class PgTenantResolver {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly pool: Pool) {}

  /** Resolve a normalized host to an active tenant, or null (fail closed). */
  async tenantForHost(host: string): Promise<ResolvedTenant | null> {
    const cached = this.cache.get(host);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) this.cache.delete(host);

    const { rows } = await this.pool.query<ResolvedTenant & { active: boolean }>(
      `select t.tenant_id as "tenantId", t.slug, t.display_name as "displayName", t.status, d.active
         from domains d
         join tenants t on t.tenant_id = d.tenant_id
        where d.host = $1
          and d.active = true
          and d.verification = 'verified'
          and t.status = 'active'`,
      [host],
    );
    const value = rows[0]
      ? { tenantId: rows[0].tenantId, slug: rows[0].slug, displayName: rows[0].displayName, status: rows[0].status }
      : null;
    this.remember(host, value);
    return value;
  }

  private remember(host: string, value: ResolvedTenant | null): void {
    this.cache.delete(host);
    while (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    this.cache.set(host, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  /** Slug lookup for the development override path only. */
  async tenantForSlug(slug: string): Promise<ResolvedTenant | null> {
    const { rows } = await this.pool.query<ResolvedTenant>(
      `select tenant_id as "tenantId", slug, display_name as "displayName", status
         from tenants where slug = $1 and status = 'active'`,
      [slug],
    );
    return rows[0] ?? null;
  }
}
