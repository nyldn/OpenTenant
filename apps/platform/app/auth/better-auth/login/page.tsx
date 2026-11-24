import { notFound } from "next/navigation";
import { safeReturnPath } from "@opentenant/auth";
import { identityProviderFromEnv } from "../../../../lib/identity";
import { BetterAuthForms } from "./forms";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (identityProviderFromEnv() !== "better-auth") notFound();
  const query = await searchParams;
  const value = (key: string) => typeof query[key] === "string" ? query[key].slice(0, 254) : "";
  return <main className="mx-auto w-full max-w-lg space-y-6 px-4 py-8">
    <h1 className="font-display text-2xl font-bold">Sign in to OpenTenant</h1>
    <BetterAuthForms returnPath={safeReturnPath(value("return"))} invitation={value("invitation")} email={value("email")} name={value("name")} signup={value("action") === "signup"} error={value("error")} />
  </main>;
}
