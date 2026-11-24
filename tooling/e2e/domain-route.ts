import { domainMutation } from "../../apps/platform/lib/custom-domains-handler";
import { serverConfig } from "../../apps/platform/lib/server-config";
import { tenants } from "./tenants.mjs";

export const runtime = "nodejs";

async function stubResolveTxt(record: string): Promise<string[][]> {
  if (serverConfig().NODE_ENV === "production" || process.env.OPENTENANT_E2E !== "1") {
    throw new Error("E2E DNS composition is disabled");
  }
  const url = new URL(`http://127.0.0.1:${process.env.E2E_DNS_PORT}/__e2e/dns`);
  url.searchParams.set("record", record);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("E2E DNS control unavailable");
  return response.json() as Promise<string[][]>;
}

const mutate = domainMutation(stubResolveTxt);

// Next dev constructs absolute request URLs from its localhost listener.
// Preserve the browser's synthetic origin for the real same-origin guard.
export function POST(request: Request) {
  const host = request.headers.get("host");
  const allowed = process.env.E2E_HOST_SUFFIX === "localhost"
    ? new RegExp(`^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?\\.localhost:${process.env.E2E_APP_PORT}$`, "u").test(host ?? "")
    : tenants.some(({ slug }) => host === `${slug}.example.test:${process.env.E2E_APP_PORT}`);
  if (!allowed) {
    return new Response("forbidden", { status: 403 });
  }
  const url = new URL(request.url);
  url.host = host!;
  return mutate(new Request(url, request));
}
