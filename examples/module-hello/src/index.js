// SPDX-License-Identifier: Apache-2.0
import greetingsMigration from "../sql/tenant-hello/0001_greetings.sql";
import { defineModule } from "@opentenant/module-sdk";

export const helloModule = defineModule({
  tenantSchemas: ["hello"],
  manifest: {
    key: "hello", version: "0.1.0", runtime: "native",
    navigation: [{ id: "hello.home", defaultLabel: "Hello", route: "/hello",
      configurable: ["label", "order", "visibility"], requiredPermission: "hello.use" }],
    permissions: ["hello.use", "hello.configure"],
  },
  routes: [{ path: "/hello", requiredPermission: "hello.use",
    render: (context) => ({ title: "Hello", body: `Welcome to ${context.tenantId}.` }) }],
  adminPages: [],
  settingsPanels: [{ id: "greeting", title: "Greeting", requiredPermission: "hello.configure",
    render: () => ({ title: "Greeting", body: "Your installed Hello module is ready." }) }],
  permissions: { declared: ["hello.use", "hello.configure"], roles: {
    tenant_owner: ["hello.use", "hello.configure"],
    tenant_admin: ["hello.use", "hello.configure"], tenant_member: ["hello.use"],
  } },
  migrations: { controlPlane: [], tenant: [{ id: "tenant-hello/0001_greetings", sql: greetingsMigration }] },
  catalog: { displayName: "Hello", enabledByDefault: false },
});
