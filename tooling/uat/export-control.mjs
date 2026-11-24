// Called only after the operator's worktree/run/container guards pass.
export async function expireExports({ db }, slug) {
  const { rows } = await db.query(`
    with tenant as (select tenant_id from tenants where slug=$1),
    expired as (
      update tenant_export_archives a
      set expires_at=least(a.expires_at,statement_timestamp()-interval '1 second')
      from tenant t where a.tenant_id=t.tenant_id returning a.id
    )
    select exists(select 1 from tenant) as tenant_exists,
           (select count(*)::int from expired) as expired_exports`, [slug]);
  if (!rows[0]?.tenant_exists) throw new Error("Unknown synthetic tenant slug");
  return { slug, expiredExports: rows[0].expired_exports };
}
