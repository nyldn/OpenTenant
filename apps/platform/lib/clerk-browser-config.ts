import { configurationEnvironment } from "./server-config";
/** Public-only Clerk browser configuration shared by server-rendered layouts. */
export function clerkBrowserPublishableKey(
  env: Readonly<Record<string, string | undefined>> = configurationEnvironment(),
): string {
  const value = (
    env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? env.CLERK_PUBLISHABLE_KEY
  )?.trim();
  if (!value) throw new Error("Incomplete Clerk browser configuration");
  return value;
}
