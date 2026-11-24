import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleHostServices } from "@opentenant/database/module-host";
import { createSupportAiApi, validAiCreate, validAiReview } from "./support-ai-api";
import { PgSupportAiReviewStore, SupportAiNotFound } from "./support-ai-review-store";
import { SUPPORT_AI_PERMISSIONS } from "./support-ai-review-types";
const { gate }=vi.hoisted(()=>({gate:vi.fn()}));
vi.mock("./host-context",()=>({createSupportContext:()=>gate}));
const id="11111111-1111-4111-8111-111111111111";
const body={ticketId:id,expectedTicketVersion:1,idempotencyKey:"request-1"};
const context={tenantId:"tenant_a",session:{userId:"staff",activeTenantId:"tenant_a",isPlatformAdmin:false},capabilities:{readTenant:true,replyTenant:true}};
let permissions:string[];
const host={resolvePermissions:vi.fn(async()=>permissions),sameOrigin:vi.fn(()=>true),enforceMutationRateLimit:vi.fn(async()=>null),withTenantDb:vi.fn()} as unknown as ModuleHostServices;
const request=(value:unknown=body,path="",method="POST")=>new Request(`https://example.test/api/support/ai/suggestions${path}`,{method,...(method==="POST"?{headers:{"Content-Type":"application/json"},body:JSON.stringify(value)}:{})});
beforeEach(()=>{vi.restoreAllMocks(); permissions=Object.values(SUPPORT_AI_PERMISSIONS); gate.mockResolvedValue({ok:true,context});});
describe("Support AI authority and exact request boundary",()=>{
  it.each([{}, {...body,tenantId:"other"},{...body,provider:"live"},{...body,expectedTicketVersion:0},{...body,expectedTicketVersion:2147483648},{...body,idempotencyKey:"x".repeat(129)}])("refuses caller-selected scope, policy and invalid input",async value=>{
    expect(validAiCreate(value)).toBe(false); expect((await createSupportAiApi(host)(request(value))).status).toBe(400);
  });
  it("accepts only the approved literal review body",()=>{
    expect(validAiReview({suggestionId:id,decision:"reviewed",expectedTicketVersion:1})).toBe(true);
    expect(validAiReview({suggestionId:id,decision:"reviewed",expectedTicketVersion:1,reply:"send this"})).toBe(false);
  });
  it("rejects coerced review decisions before reaching the tenant store",async()=>{
    const review=vi.spyOn(PgSupportAiReviewStore.prototype,"review");
    for (const decision of [["reviewed"], {value:"reviewed"}, null, "sent"]) {
      expect((await createSupportAiApi(host)(request({suggestionId:id,decision,expectedTicketVersion:1},"/reviews"))).status).toBe(400);
    }
    expect(review).not.toHaveBeenCalled();
  });
  it.each([
    {readTenant:false,replyTenant:true}, {readTenant:true,replyTenant:false},
  ])("requires both staff ticket permissions",async capabilities=>{
    gate.mockResolvedValue({ok:true,context:{...context,capabilities}});
    expect((await createSupportAiApi(host)(request())).status).toBe(404);
    expect(host.withTenantDb).not.toHaveBeenCalled();
  });
  it("requires explicit suggestion/review permissions beyond staff ticket grants",async()=>{
    permissions=[]; expect((await createSupportAiApi(host)(request())).status).toBe(404);
    permissions=[SUPPORT_AI_PERMISSIONS.suggest];
    expect((await createSupportAiApi(host)(request({suggestionId:id,decision:"reviewed",expectedTicketVersion:1},"/reviews"))).status).toBe(404);
  });
  it.each([{...context.session,activeTenantId:"other"},{...context.session,isPlatformAdmin:true}])("excludes owner/managed authority and tenant switching",async session=>{
    gate.mockResolvedValue({ok:true,context:{...context,session}});
    expect((await createSupportAiApi(host)(request())).status).toBe(404);
  });
  it("reauthorizes each read after permission revocation or module disablement",async()=>{
    const read=vi.spyOn(PgSupportAiReviewStore.prototype,"read").mockResolvedValue({request:null,terminal:null,suggestion:null,visibility:"current",policy:null});
    const api=createSupportAiApi(host); const get=()=>request(undefined,`?ticketId=${id}`,"GET");
    expect((await api(get())).headers.get("cache-control")).toBe("no-store");
    permissions=[]; expect((await api(get())).status).toBe(404);
    gate.mockResolvedValue({ok:false,reason:"forbidden"}); expect((await api(get())).status).toBe(404);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("makes missing and cross-tenant review IDs indistinguishable and binds the session tenant",async()=>{
    const review=vi.spyOn(PgSupportAiReviewStore.prototype,"review").mockRejectedValue(new SupportAiNotFound());
    const api=createSupportAiApi(host);
    const first=await api(request({suggestionId:id,decision:"reviewed",expectedTicketVersion:1},"/reviews"));
    const second=await api(request({suggestionId:"22222222-2222-4222-8222-222222222222",decision:"reviewed",expectedTicketVersion:1},"/reviews"));
    expect(first.status).toBe(404); expect(second.status).toBe(404); expect(await first.text()).toBe(await second.text());
    expect(review).toHaveBeenCalledWith({tenantId:"tenant_a",actorId:"staff",kind:"tenant_admin"},id,1,"reviewed");
  });
  it("bounds JSON bytes and rejects selector queries",async()=>{
    expect((await createSupportAiApi(host)(request({...body,extra:"x".repeat(5000)}))).status).toBe(400);
    expect((await createSupportAiApi(host)(request(undefined,`?ticketId=${id}&tenantId=other`,"GET"))).status).toBe(400);
  });
});
