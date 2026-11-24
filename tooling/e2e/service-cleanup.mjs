import { Pool } from "pg";

/** Clean only projects recorded in this run's uniquely named control plane.
 * @param {string} controlUrl
 */
export async function cleanupServiceDatabases(controlUrl) {
  const url = new URL(controlUrl);
  const controlName = url.pathname.slice(1);
  if (!/^opentenant_it_e2e_[a-f0-9]+$/u.test(controlName)) throw new Error("Unsafe E2E control database");
  const control = new Pool({ connectionString: url.href });
  let projects;
  try {
    const table = await control.query("select to_regclass('public.provisioning_jobs') as name");
    projects = table.rows[0].name ? (await control.query("select project_id from provisioning_jobs where project_id is not null")).rows : [];
  } finally { await control.end(); }
  url.pathname = "/postgres";
  const admin = new Pool({ connectionString: url.href });
  try {
    for (const { project_id: name } of projects) {
      if (!/^opentenant_[a-z0-9_]{1,51}$/u.test(name)) throw new Error("Unsafe provisioned database");
      await admin.query(`drop database if exists "${name}" with (force)`);
      await admin.query(`drop role if exists "${name}_app"`);
    }
    await admin.query(`drop database if exists "${controlName}" with (force)`);
  } finally { await admin.end(); }
}
