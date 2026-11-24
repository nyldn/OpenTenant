import { expect, it, vi } from "vitest";
import { vercelHostingDomainPort } from "./hosting";

it("is disabled without configuration and never calls hosting", async () => {
  const fetcher = vi.fn();
  expect(await vercelHostingDomainPort({}, fetcher).addDomain("app.customer.test")).toEqual({ status: "disabled" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("prepares the documented POST without exposing the env token or sending it", async () => {
  const fetcher = vi.fn();
  const port = vercelHostingDomainPort({ OPENTENANT_HOSTING_PROVIDER: "vercel", VERCEL_PROJECT_ID: "synthetic-project", VERCEL_TOKEN: "synthetic-secret" }, fetcher);
  const result = await port.addDomain("app.customer.test");
  expect(result).toEqual({ status: "dry-run", request: { method: "POST", url: "https://api.vercel.com/v10/projects/synthetic-project/domains", body: { name: "app.customer.test" } } });
  expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  expect(fetcher).not.toHaveBeenCalled();
});
