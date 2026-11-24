import { createHash } from "node:crypto";
import type { EmailTransport } from "@opentenant/notifications/email";
import type { BetterAuthHooks } from "./runtime";
/** No transport means no delivery hooks. URLs never enter logs or error messages. */
export function betterAuthMailHooks(transport: EmailTransport | undefined, baseURL: string, invitationOrigin?: (organizationId: string) => Promise<string>, invitationReturnPath?: string): BetterAuthHooks {
  if (!transport) return {};
  const send = async (email: string, subject: string, url: string) => {
    const result = await transport.send({ to: email, subject, html: "", text: `${subject}\n${url}`, idempotencyKey: createHash("sha256").update(url).digest("hex") });
    if (!result.ok) throw new Error("Identity email delivery failed");
  };
  return {
    sendVerificationEmail: message => send(message.email, "Verify your email", message.url),
    sendInvitationEmail: async message => {
      const url = new URL("/api/auth/better-auth/login", invitationOrigin ? await invitationOrigin(message.organizationId) : baseURL);
      url.searchParams.set("invitation", message.invitationId);
      if (invitationReturnPath) url.searchParams.set("return", invitationReturnPath);
      return send(message.email, "Your tenant invitation", url.toString());
    },
  };
}
