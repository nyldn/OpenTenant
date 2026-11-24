"use client";
import { useEffect, useRef } from "react";
import { Button, FormField, FormStatus, Input, SharedForm, type FormOutcome } from "@opentenant/design-system";
import { navigateBrowser } from "@opentenant/platform-core/runtime-globals";
const errors: Record<string, string> = {
  credentials: "We could not sign you in. Check your email and password, then try again.",
  signup: "We could not create this account. If you already have an account, sign in above. Otherwise check your details and try again.",
  invitation: "Your account is available, but the invitation could not be accepted. Verify your email if requested, then sign in with the invited email. Ask your administrator for a new invitation if it has expired.",
  verification: "Check your email to verify your account, then sign in here with the same invitation.",
  unavailable: "Sign-in is temporarily unavailable. Please try again.",
  rate_limit: "Too many sign-in attempts. Wait a minute, then try again.",
};
export function BetterAuthForms(props: { returnPath: string; invitation: string; email: string; name: string; signup: boolean; error: string }) {
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const alert = summary.current?.querySelector<HTMLElement>('[role="alert"]');
    if (props.error && alert) { alert.tabIndex = -1; alert.focus(); }
  }, [props.error]);
  async function submit(data: FormData): Promise<FormOutcome> {
    const response = await fetch(`/api/auth/better-auth/login?return=${encodeURIComponent(props.returnPath)}`, { method: "POST", headers: { accept: "application/vnd.opentenant.auth-form+json" }, body: data, credentials: "same-origin" });
    const result = await response.json();
    if (!response.ok) return { status: "error", message: errors[result.error] ?? errors.unavailable! };
    if (typeof result.redirect !== "string" || !result.redirect.startsWith("/") || result.redirect.startsWith("//")) return { status: "error", message: errors.unavailable! };
    navigateBrowser(result.redirect);
    return { status: "success", message: "Signed in. Opening your tenant." };
  }
  const nativeAction = { action: `/api/auth/better-auth/login?return=${encodeURIComponent(props.returnPath)}` };
  function fields(signup: boolean) {
    return <>
      <input type="hidden" name="action" value={signup ? "signup" : "login"} />
      {signup && <FormField name="name" label="Name">{control => <Input {...control} autoComplete="name" defaultValue={props.name} required />}</FormField>}
      <FormField name="email" label="Email">{control => <Input {...control} type="email" autoComplete="username" defaultValue={props.email} required />}</FormField>
      <FormField name="password" label="Password">{control => <Input {...control} type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={8} required />}</FormField>
      <FormField name="invitation" label="Invitation reference, if provided" help="Keep this reference when accepting a tenant invitation.">{control => <Input {...control} defaultValue={props.invitation} />}</FormField>
    </>;
  }
  return <>
    {props.error && <div ref={summary}><FormStatus status="error"><h2 className="font-semibold">Check your sign-in details</h2><p>{errors[props.error] ?? errors.unavailable}</p></FormStatus></div>}
    <SharedForm {...nativeAction} id="login" method="post" onSubmit={submit} submitLabel="Sign in" pendingLabel="Signing in…">{fields(false)}</SharedForm>
    <details open={props.signup || undefined} className="rounded-lg border border-border p-4">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold focus-visible:ring-2 focus-visible:ring-ring">Create an account</summary>
      <SharedForm {...nativeAction} id="signup" method="post" onSubmit={submit} submitLabel="Create account" pendingLabel="Creating account…">{fields(true)}</SharedForm>
    </details>
    <form method="post" action="/api/auth/better-auth/sign-out"><Button type="submit" variant="outline">Sign out</Button></form>
  </>;
}
