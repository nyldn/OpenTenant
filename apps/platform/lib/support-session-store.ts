import type { Pool } from "pg";
import { PgSupportSessionStore } from "@opentenant/database";
import { controlPlanePool } from "./control-plane";

let store: PgSupportSessionStore | null = null;

export function supportSessionDatabase(): Pool {
  return controlPlanePool();
}

export function supportSessionStore(): PgSupportSessionStore {
  if (!store) {
    store = new PgSupportSessionStore(supportSessionDatabase());
  }
  return store;
}
