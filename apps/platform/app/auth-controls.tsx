"use client";

import {
  OrganizationSwitcher,
  Show,
  SignInButton,
  SignOutButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";

export function ClerkAuthControls() {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className="inline-flex min-h-11 items-center rounded-md border border-border px-3 py-1.5 hover:bg-accent">Sign in</button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button className="inline-flex min-h-11 items-center rounded-md bg-primary px-3 py-1.5 text-primary-foreground">Sign up</button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <OrganizationSwitcher hidePersonal />
        <UserButton />
        <SignOutButton redirectUrl="/auth/logout">
          <button className="inline-flex min-h-11 items-center rounded-md border border-border px-3 py-1.5 hover:bg-accent">Sign out</button>
        </SignOutButton>
      </Show>
    </div>
  );
}

export function ClerkOrganizationControls() {
  return <OrganizationSwitcher hidePersonal />;
}
