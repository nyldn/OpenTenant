import { serverConfig } from "../../../../../../lib/server-config";
import { randomUUID } from "node:crypto";
import { isValidModuleKey } from "@opentenant/platform-core";
import { verifyModuleContext } from "@opentenant/security";
import { brokerSupportTicketSummaries } from "../../../../../../lib/module-capability-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const bearerPattern = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u;

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function error(status: number, code: string, correlationId?: string): Response {
  return json(status, {
    error: { code },
    ...(correlationId === undefined ? {} : { correlationId }),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ module: string }> },
): Promise<Response> {
  const { module: moduleKey } = await context.params;
  if (!isValidModuleKey(moduleKey)) return error(401, "invalid_context");

  const publicKey = serverConfig().MODULE_SIGNING_PUBLIC_KEY;
  if (!publicKey) return error(500, "broker_failed");
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(bearerPattern);
  if (!bearer?.[1]) return error(401, "invalid_context");

  const verified = verifyModuleContext(bearer[1], publicKey, { moduleKey });
  if (!verified.valid) return error(401, "invalid_context");

  const correlationId = randomUUID();
  try {
    const result = await brokerSupportTicketSummaries(verified.claims, correlationId);
    if (!result.allowed) return error(403, "capability_denied", correlationId);
    return json(200, { tickets: result.value, correlationId });
  } catch {
    return error(500, "broker_failed", correlationId);
  }
}
