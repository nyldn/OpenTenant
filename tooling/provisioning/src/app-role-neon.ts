import { Client } from "pg";
import { grantAppRolePrivileges, pooledHost, type AppRoleResult } from "./app-role";
import type { CredentialRotationPort, CredentialRotationRequest } from "./app-role-rotation";

/**
 * Local adapter contract, NOT an implemented/reviewed HTTP endpoint. Existing
 * repo evidence covers Neon project APIs and the need for role-reset API use,
 * but does not contain a reviewed reset-password response/operation schema.
 * A composition root must supply a reviewed transport which waits for provider
 * operations to finish, returns the generated password and never logs bodies.
 */
export interface NeonRolePasswordApi {
  resetRolePassword(target: { projectId: string; branchId: string; roleName: string }): Promise<{ password: string }>;
}

export interface NeonRotationTarget {
  projectId: string;
  branchId: string;
  /** Exact direct endpoint from the provisioned project. Never infer project identity from a URI. */
  hostname: string;
}

export class NeonCredentialRotation implements CredentialRotationPort {
  readonly targetId: string;
  constructor(private readonly target: NeonRotationTarget, private readonly api: NeonRolePasswordApi) {
    this.targetId = JSON.stringify(["neon", target.projectId, target.branchId, target.hostname]);
  }
  async rotate(request: CredentialRotationRequest): Promise<AppRoleResult> {
    let client: Client | undefined;
    let result: AppRoleResult | undefined;
    try {
      const uri = new URL(request.ownerConnectionUri);
      if (uri.hostname !== this.target.hostname || !uri.hostname.endsWith(".neon.tech") || uri.hostname.split('.')[0]?.endsWith('-pooler') ||
          uri.searchParams.get("sslmode") !== "verify-full" || !/^[a-z][a-z0-9_]{0,62}$/.test(request.roleName) ||
          !this.target.projectId || !this.target.branchId) throw new Error();
      client = new Client({ connectionString: request.ownerConnectionUri });
      await client.connect();
      const { rows } = await client.query<{ exists: boolean }>("select exists(select 1 from pg_roles where rolname = $1) as exists", [request.roleName]);
      if (!rows[0]?.exists) await client.query(`create role ${request.roleName} nologin nobypassrls nosuperuser nocreatedb nocreaterole noreplication`);
      await client.query(`alter role ${request.roleName} with login nobypassrls nosuperuser nocreatedb nocreaterole noreplication`);
      await grantAppRolePrivileges(client, request.ownerConnectionUri, request.roleName);
      const credential = await this.api.resetRolePassword({ projectId: this.target.projectId, branchId: this.target.branchId, roleName: request.roleName });
      if (typeof credential.password !== "string" || credential.password.length < 16 || credential.password.length > 1024 || [...credential.password].some(character => character.charCodeAt(0) < 32)) throw new Error();
      uri.username = request.roleName; uri.password = credential.password; uri.hostname = pooledHost(uri.hostname);
      result = { appConnectionUri: uri.toString() };
    } catch { result = undefined; }
    finally { try { await client?.end(); } catch { result = undefined; } }
    if (!result) throw new Error("Neon application credential rotation failed");
    return result;
  }
}
