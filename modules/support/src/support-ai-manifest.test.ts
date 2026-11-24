import { expect, it } from "vitest";
import { SUPPORT_MANIFEST, SUPPORT_MODULE } from "./manifest";
import { SUPPORT_AI_PERMISSIONS } from "./support-ai-review-types";
it("registers literal suggestion routes and grants their explicit capabilities only to staff",()=>{
  for(const permission of Object.values(SUPPORT_AI_PERMISSIONS)){
    expect(SUPPORT_MANIFEST.permissions).toContain(permission);
    expect(SUPPORT_MANIFEST.rolePermissions?.tenant_owner).toContain(permission);
    expect(SUPPORT_MANIFEST.rolePermissions?.tenant_admin).toContain(permission);
    expect(SUPPORT_MANIFEST.rolePermissions?.tenant_member).not.toContain(permission);
  }
  expect(SUPPORT_MODULE.apiRoutes?.map(route=>route.path)).toEqual(["/api/support/tickets","/api/support/ai/suggestions","/api/support/ai/suggestions/reviews"]);
});
