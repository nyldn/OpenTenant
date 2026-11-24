import { SignUp } from "@clerk/nextjs";
import { notFound } from "next/navigation";
import { usesClerkIdentity } from "../../../lib/identity-provider";

export default function SignUpPage() {
  if (!usesClerkIdentity()) notFound();
  return (
    <main className="flex min-h-svh items-center justify-center px-6">
      <SignUp />
    </main>
  );
}
