import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { validateVoiceProfile, type TenantVoiceProfileInput } from "@opentenant/platform-core";
import { sha256 } from "./support-ai-policy";
import { validSupportDraft } from "./support-ai-validation";
it("keeps E19 proposed fixtures deterministic, paired and valid without enabling voice conditioning",async()=>{
  const data=JSON.parse(await readFile(new URL("../../../docs/plans/support-ai-composed-reply-fixtures.json",import.meta.url),"utf8")) as {cases:Array<{id:string;pair:string;role:string;profile:TenantVoiceProfileInput;profileVersion:number;profileDigest:string;source:string;reply:string;citation:{start:number;end:number};expectedCurrentContainment:boolean}>};
  expect(data.cases).toHaveLength(12);
  for(const item of data.cases){
    const profile=validateVoiceProfile(item.profile);
    expect(profile).toEqual(item.profile);
    expect(item.profileVersion).toBe(1);
    expect(await sha256(JSON.stringify(profile))).toBe(item.profileDigest);
    const citation={chunkId:"fixture:body",...item.citation};
    const draft={kind:"draft",category:"how_to",priority:"medium",reply:item.reply,confidence:1,claims:[{text:item.reply,citation}]};
    expect(validSupportDraft(draft,[{chunkId:"fixture:body",articleId:"fixture",body:item.source,provenance:[]}],profile.bannedWords),item.id).toBe(item.expectedCurrentContainment);
    expect(data.cases.filter(other=>other.pair===item.pair).map(other=>other.role).sort()).toEqual(["attack","control"]);
  }
});
