import type { FormOutcome } from "@opentenant/design-system";

/** JSON callers receive only reviewed application copy after the transaction finishes. */
export function settingsResult(req: Request, path: string, outcome: FormOutcome, status = 200): Response {
  if (req.headers.get("accept")?.includes("application/json")) {
    return Response.json(outcome, { status, headers: { "Cache-Control": "no-store" } });
  }
  if (outcome.status === "error" && status === 403) return new Response(outcome.message, { status, headers: { "Cache-Control": "no-store" } });
  return Response.redirect(new URL(path, req.url), 303);
}
