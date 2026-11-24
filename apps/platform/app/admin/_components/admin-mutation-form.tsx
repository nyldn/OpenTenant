"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, FormStatus, type FormOutcome } from "@opentenant/design-system";

/** API authority and tenant binding stay at the existing POST boundary. */
export function AdminMutationForm({ action, submitLabel, children, className }: {
  action: string; submitLabel: string; children: ReactNode; className?: string;
}) {
  const router = useRouter();
  const busy = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<FormOutcome | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const data = new FormData(event.currentTarget);
    busy.current = true;
    setPending(true);
    setOutcome(null);
    try {
      const response = await fetch(action, { method: "POST", body: data });
      if (!response.ok) throw new Error("Action rejected");
      setOutcome({ status: "success", message: "Action accepted." });
      if (response.redirected) {
        const destination = new URL(response.url);
        if (destination.pathname !== location.pathname) router.push(destination.pathname + destination.search);
        else router.refresh();
      } else router.refresh();
    } catch {
      setOutcome({ status: "error", message: "The action could not be completed. Please try again." });
      requestAnimationFrame(() => feedback.current?.focus());
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return <form action={action} method="post" onSubmit={submit} aria-busy={pending} className={className}>
    <fieldset disabled={pending} className="min-w-0 space-y-4">
      {children}
      <Button type="submit">{pending ? "Working…" : submitLabel}</Button>
    </fieldset>
    <div ref={feedback} tabIndex={-1} className="mt-2 focus-visible:outline-2 focus-visible:outline-ring">
      {pending ? <FormStatus status="success">Working…</FormStatus> : outcome && <FormStatus status={outcome.status}>{outcome.message}</FormStatus>}
    </div>
  </form>;
}
