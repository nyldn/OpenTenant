import { beforeEach, expect, it, vi } from "vitest";
import type { ModuleHostServices } from "@opentenant/database/module-host";
import { SupportAiReviewMount } from "./support-ai-review-mount";
import { PgSupportAiReviewStore } from "./support-ai-review-store";
const {gate}=vi.hoisted(()=>({gate:vi.fn()}));
vi.mock("./host-context",()=>({createSupportContext:()=>gate}));
let permissions:string[];
const host={resolvePermissions:async()=>permissions} as unknown as ModuleHostServices;
const view={request:null,terminal:null,suggestion:null,visibility:"current" as const,policy:null};
beforeEach(()=>{
  vi.restoreAllMocks();
  permissions=["support.ai.suggest","support.ai.review"];
  gate.mockResolvedValue({ok:true,context:{tenantId:"tenant_a",session:{userId:"staff",activeTenantId:"tenant_a",isPlatformAdmin:false},capabilities:{readTenant:true,replyTenant:true}}});
});
it("reloads durable state through current page authority and conceals revocation before reading",async()=>{
  const read=vi.spyOn(PgSupportAiReviewStore.prototype,"read").mockResolvedValue(view);
  const panel=await SupportAiReviewMount({host,ticketId:"ticket",ticketVersion:1});
  expect(panel?.props.initialView).toEqual(view);
  expect(read).toHaveBeenCalledWith({tenantId:"tenant_a",actorId:"staff",kind:"tenant_admin"},"ticket");
  permissions=[];
  expect(await SupportAiReviewMount({host,ticketId:"ticket",ticketVersion:1})).toBeNull();
  expect(read).toHaveBeenCalledTimes(1);
});
