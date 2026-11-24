import { Pool } from "pg";
import { CredentialCipher } from "@opentenant/database";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { ownerToken } from "../tenants.mjs";

// Beta keeps both the shared legacy queue and R3's Alpha delivery fixture intact.
test("reviewed suggestion persists without mutating ticket",async({page,context})=>{
  test.setTimeout(120000);
  const tenantId="tenant_e2e_beta";
  const origin=process.env.LOCAL_PUBLIC_ORIGIN!;
  const control=new Pool({connectionString:process.env.CONTROL_PLANE_DATABASE_URL});
  let admin:Pool|undefined;
  const auth=async(slug:string)=>context.addCookies([
    {name:"opentenant_dev_tenant",value:slug,url:origin},
    {name:"opentenant_session",value:ownerToken(slug),url:origin,httpOnly:true,sameSite:"Lax"},
  ]);
  try{
    const binding=(await control.query("select encrypted_connection from tenant_databases where tenant_id=$1",[tenantId])).rows[0];
    const runtimeUrl=new CredentialCipher(process.env.TENANT_DB_ENCRYPTION_KEY!).decrypt(binding.encrypted_connection.toString("utf8"),tenantId);
    const adminUrl=new URL(process.env.POSTGRES_ADMIN_DATABASE_URL!); adminUrl.pathname=new URL(runtimeUrl).pathname;
    admin=new Pool({connectionString:adminUrl.href});
    await admin.query("insert into support.ai_controls(tenant_id,enabled,synthetic) values($1,true,true) on conflict(tenant_id) do update set enabled=true,synthetic=true",[tenantId]);
    const article=(await admin.query("insert into support.knowledge_articles(tenant_id,title,content,category,status,created_by) values($1,'Password help','You can reset your password in Settings. Keep your recovery codes safe.','how_to','published','synthetic-editor') returning id",[tenantId])).rows[0];
    await auth("beta");
    await page.goto(`${origin}/support`);
    await page.getByLabel("Subject",{exact:true}).fill("Reviewed AI suggestion browser proof");
    await page.getByLabel("What happened?",{exact:true}).fill("Synthetic password reset question.");
    await page.getByRole("button",{name:"Open ticket",exact:true}).click();
    await expect(page).toHaveURL(/\/support\/[0-9a-f-]{36}$/u);
    const path=new URL(page.url()).pathname;
    const ticketId=path.split("/").at(-1)!;
    const snapshot=async()=>({
      ticket:(await admin!.query("select version::int,category,priority,status,assigned_to from support.tickets where id=$1",[ticketId])).rows[0],
      messages:(await admin!.query("select * from support.messages where ticket_id=$1",[ticketId])).rows,
      events:(await admin!.query("select * from support.ticket_events where ticket_id=$1",[ticketId])).rows,
      outbox:(await admin!.query("select * from support.outbox_events where ticket_id=$1",[ticketId])).rows,
      email:(await admin!.query("select * from support.email_deliveries where ticket_id=$1",[ticketId])).rows,
    });
    const before=await snapshot();
    const panel=page.getByRole("region",{name:"Support AI suggestions"});
    await expect(panel).toBeVisible();
    await panel.getByRole("button",{name:"Request suggestion",exact:true}).click();
    await expect(panel.locator("blockquote")).toHaveText("You can reset your password in Settings.");
    await expect(page.getByLabel("Reply",{exact:true})).toHaveValue("");
    expect(await snapshot()).toEqual(before);
    await page.reload();
    await expect(panel.locator("blockquote")).toHaveText("You can reset your password in Settings.");
    const suggestion=(await admin.query("select id from support.ai_suggestions where request_id in(select id from support.ai_suggestion_requests where ticket_id=$1)",[ticketId])).rows[0];
    // A real different tenant gets the same 404 for this ID and an absent ID.
    await auth("alpha");
    const reviews=`${origin}/api/support/ai/suggestions/reviews`;
    const foreign=await context.request.post(reviews,{headers:{origin},data:{suggestionId:suggestion.id,decision:"reviewed",expectedTicketVersion:1}});
    const missing=await context.request.post(reviews,{headers:{origin},data:{suggestionId:"00000000-0000-4000-8000-000000000000",decision:"reviewed",expectedTicketVersion:1}});
    expect(foreign.status()).toBe(404); expect(missing.status()).toBe(404); expect(await foreign.text()).toBe(await missing.text());
    await auth("beta");
    await panel.getByRole("button",{name:"Mark reviewed",exact:true}).click();
    await expect(panel.getByRole("button",{name:"Use in reply",exact:true})).toBeVisible();
    expect(await snapshot()).toEqual(before);
    await page.reload();
    for(const width of [390,768,1440]){
      await page.setViewportSize({width,height:900});
      await expect(panel.getByRole("button",{name:"Use in reply",exact:true})).toBeVisible();
      expect(await page.evaluate(()=>Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)-innerWidth)).toBeLessThanOrEqual(1);
    }
    expect((await new AxeBuilder({page}).include('[aria-labelledby="support-ai-heading"]').analyze()).violations).toEqual([]);
    await panel.getByRole("button",{name:"Use in reply",exact:true}).click();
    const editor=page.getByLabel("Reply",{exact:true});
    await expect(editor).toHaveValue("You can reset your password in Settings.");
    expect(await snapshot()).toEqual(before);
    await editor.fill("You can reset your password in Settings. I checked these steps for this request.");
    await page.getByRole("button",{name:"Send",exact:true}).click();
    await expect(page.getByRole("status").filter({hasText:"Reply sent."})).toBeVisible();
    const sent=await snapshot(); expect(sent.messages).toHaveLength(1); expect(sent.messages[0].message_type).toBe("reply");
    expect(sent.messages[0].body).toBe("You can reset your password in Settings. I checked these steps for this request.");
    expect(sent.ticket.version).toBe(2); expect(sent.ticket.category).toBe(before.ticket.category);
    // The normal form refreshes the server page after reporting success. Wait
    // for its new ticket version before deliberately requesting another draft.
    await expect(panel.getByText("This suggestion is stale.",{exact:false})).toBeVisible();
    await panel.getByRole("button",{name:"Request suggestion",exact:true}).click();
    await expect(panel.getByRole("button",{name:"Mark reviewed",exact:true})).toBeVisible();
    await admin.query("update support.knowledge_articles set status='archived' where id=$1",[article.id]);
    await page.reload();
    await expect(panel.getByText("This suggestion is revoked.",{exact:false})).toBeVisible();
    await expect(panel.locator("blockquote")).toHaveCount(0);
    await expect(panel.getByRole("button",{name:"Use in reply",exact:true})).toHaveCount(0);
    expect((await snapshot()).messages).toHaveLength(1);
    expect((await admin.query("select * from support.ai_suggestions where request_id in(select id from support.ai_suggestion_requests where ticket_id=$1)",[ticketId])).rows).toHaveLength(2);
  } finally { await admin?.end(); await control.end(); }
});
