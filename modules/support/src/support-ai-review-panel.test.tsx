import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SupportAiReviewPanel } from "./support-ai-review-panel";
it("has no form, send control, automatic ticket action or deferred voice field",()=>{
  const html=renderToStaticMarkup(<SupportAiReviewPanel ticketId="example" ticketVersion={1} canReview />);
  expect(html).toContain("Review required."); expect(html).toContain('type="button"');
  for(const disallowed of ["<form","type=\"submit\"","Apply category","Apply priority","preferredWords","exampleRewrites","formality","/api/support/tickets"]) expect(html).not.toContain(disallowed);
});
