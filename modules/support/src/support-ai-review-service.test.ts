import { describe, expect, it } from "vitest";
import { ModelResolutionError } from "@opentenant/platform-core";
import { ROUTER_OUTCOMES } from "./support-ai-review-types";
import { supportAiFailure, SupportAiStreamError } from "./support-ai-review-service";
describe("closed Support AI router failure mapping",()=>{
  it.each(Object.entries(ROUTER_OUTCOMES))("maps %s without storing provider text",(code,expected)=>{
    expect(supportAiFailure(code === "AUDIT_ERROR" || code === "ADAPTER_ERROR" ? new SupportAiStreamError(code) : new ModelResolutionError(code as never,"PRIVATE_PROVIDER_TEXT"))).toEqual({kind:expected[0],reason:expected[1]});
  });
  it("normalizes unexpected internal failures",()=>{
    expect(supportAiFailure(Error("PRIVATE_PROVIDER_TEXT"))).toEqual({kind:"policy_unavailable",reason:"internal_error"});
  });
});
