import { beforeEach, expect, it, vi } from "vitest";
import type { ModuleHostServices } from "@opentenant/database/module-host";
import { createTicketPage } from "./host-ticket";
import { SupportAiReviewMount } from "./support-ai-review-mount";
const {gate,detail}=vi.hoisted(()=>({gate:vi.fn(),detail:vi.fn()}));
vi.mock("next/link",()=>({default:"a"}));
vi.mock("./host-context",()=>({createSupportContext:()=>gate}));
vi.mock("./index",()=>({getTicket:detail,listDeadOutboxEvents:async()=>[],TICKET_STATUSES:[],TICKET_PRIORITIES:[]}));
vi.mock("./delivery-store",()=>({listTicketEmailDeliveries:async()=>[]}));
const id="11111111-1111-4111-8111-111111111111";
const context={tenantId:"tenant_a",session:{userId:"staff",activeTenantId:"tenant_a",isPlatformAdmin:false},capabilities:{readTenant:true,replyTenant:true}};
let grants:string[];
const host={resolvePermissions:async()=>grants,withTenantDb:async(_tenant:string,work:(client:unknown)=>unknown)=>work({})} as unknown as ModuleHostServices;
beforeEach(()=>{
  grants=["support.ai.suggest","support.ai.review"];
  gate.mockResolvedValue({ok:true,context});
  detail.mockResolvedValue({ticket:{id,createdBy:"requester",subject:"Example",description:"Synthetic",ticketNumber:"SUP-1",status:"open",priority:"medium",version:3},messages:[],events:[]});
});
it("mounts the panel only for explicit staff authority and targets the existing reply textarea",async()=>{
  const view=await createTicketPage(host)({params:Promise.resolve({id})});
  const panel=view.props.children.find((child:{type?:unknown}|null)=>child?.type===SupportAiReviewMount);
  expect(panel.props).toEqual({host,ticketId:id,ticketVersion:3});
  expect(JSON.stringify(view)).toContain(`support-reply-form-${id}`);
  grants=[];
  const denied=await createTicketPage(host)({params:Promise.resolve({id})});
  expect(denied.props.children.some((child:{type?:unknown}|null)=>child?.type===SupportAiReviewMount)).toBe(false);
});
