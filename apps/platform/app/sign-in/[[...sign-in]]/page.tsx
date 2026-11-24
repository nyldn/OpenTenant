import { SignIn } from "@clerk/nextjs";
import { notFound } from "next/navigation";
import { usesClerkIdentity } from "../../../lib/identity-provider";

export default function SignInPage() {
  if (!usesClerkIdentity()) notFound();
  return (
    <main className="flex min-h-svh items-center justify-center px-6">
      <SignIn />
    </main>
  );
}
