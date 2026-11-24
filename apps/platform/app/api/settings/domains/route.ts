import { Resolver } from "node:dns/promises";
import { domainMutation } from "../../../../lib/custom-domains-handler";
export const runtime = "nodejs";

export const POST = domainMutation(async (record) => {
  const resolver = new Resolver({ timeout: 3000, tries: 1 });
  return resolver.resolveTxt(record);
});
