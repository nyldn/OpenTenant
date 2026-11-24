import type { OpenFgaClient, TupleKey } from "@openfga/sdk";

/** Synthetic implementation of the checked-in authorization.fga model.
 * No sockets, SDK retries or external service. Used through the real adapter.
 */
export class SyntheticFga {
  readonly tuples = new Map<string, TupleKey>();
  readonly operations: string[] = [];
  offline = false;
  loseAcknowledgement = false;
  loseWriteAcknowledgement = false;
  private key(t: TupleKey): string { return JSON.stringify([t.user, t.relation, t.object]); }
  private has(user: string, relation: string, object: string): boolean {
    return this.tuples.has(this.key({ user, relation, object }));
  }
  readonly client = {
    write: async (body: { writes?: TupleKey[]; deletes?: TupleKey[] }) => {
      if (this.offline) throw new Error("synthetic outage");
      this.operations.push(body.deletes ? "revoke" : "replace");
      for (const tuple of body.deletes ?? []) this.tuples.delete(this.key(tuple));
      for (const tuple of body.writes ?? []) this.tuples.set(this.key(tuple), tuple);
      if (this.loseAcknowledgement || (body.writes && this.loseWriteAcknowledgement)) { this.loseAcknowledgement = false; this.loseWriteAcknowledgement = false; throw new Error("synthetic acknowledgement loss"); }
      return {};
    },
    check: async (body: { user: string; relation: string; object: string }) => {
      if (this.offline) throw new Error("synthetic outage");
      const modules = [...this.tuples.values()].filter(t => t.object === body.object && t.relation === "module");
      const allowed = body.relation === "granted" && modules.some(module => {
        const tenants = [...this.tuples.values()].filter(t => t.object === module.user && t.relation === "tenant");
        return tenants.some(tenant => {
          const roles = ["tenant_owner", "tenant_admin", "tenant_member"];
          return this.has(`${tenant.user}#active`, "entitled", module.user)
            && roles.some(role => this.has(body.user, role, tenant.user))
            && roles.some(role => this.has(body.user, role, tenant.user) && this.has(`${tenant.user}#${role}`, "grantee", body.object));
        });
      });
      return { allowed };
    },
  } as unknown as Pick<OpenFgaClient, "write" | "check">;
}
