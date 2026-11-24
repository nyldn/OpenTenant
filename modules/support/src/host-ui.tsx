"use client";

import { useEffect, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FormField, FormStatus, Table, Textarea } from "@opentenant/design-system";

/** Use the shared table's native scrolling, adding a tab stop only on overflow. */
export function TicketTable({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = root.current?.querySelector<HTMLElement>('[data-slot="table-container"]');
    const table = viewport?.querySelector("table");
    if (!viewport || !table) return;
    viewport.classList.add("rounded-lg", "focus-visible:outline-none", "focus-visible:ring-2", "focus-visible:ring-ring", "focus-visible:ring-offset-2", "focus-visible:ring-offset-background");
    const update = () => {
      if (viewport.scrollWidth > viewport.clientWidth + 1) {
        viewport.setAttribute("role", "region");
        viewport.setAttribute("aria-label", "Support tickets");
        viewport.tabIndex = 0;
      } else {
        for (const attribute of ["role", "aria-label", "tabindex"]) viewport.removeAttribute(attribute);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(table);
    return () => observer.disconnect();
  }, [children]);
  return <div ref={root} className="mt-8 min-w-0 rounded-lg border border-border">
    <Table style={{ minWidth: "44rem" }}>{children}</Table>
  </div>;
}

export function TicketTextarea({ label, ...props }: ComponentProps<"textarea"> & { name: string; label: string }) {
  return <FormField name={props.name} label={label}>{control => <Textarea {...props} {...control} />}</FormField>;
}

export function TicketSelect({ label, ...props }: ComponentProps<"select"> & { name: string; label: string }) {
  return <FormField name={props.name} label={label}>{control => <select {...props} {...control} className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" />}</FormField>;
}

const failedSubmission = { status: "error", message: "We couldn't save your changes. Please try again." } as const;

/** The unchanged API authorizes the mutation. Only a matching successful redirect is a receipt. */
export async function submitTicketForm(action: string, data: FormData, successPath: string, create = false) {
  try {
    const response = await fetch(action, { method: "POST", body: data, credentials: "same-origin" });
    // Only redirect metadata is needed. Release streamed HTML so repeated
    // mutations cannot exhaust the browser's connections to the tenant host.
    await response.body?.cancel();
    if (!response.ok || !response.redirected) return failedSubmission;
    const destination = new URL(response.url);
    const pathMatches = create
      ? destination.pathname.startsWith(successPath) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(destination.pathname.slice(successPath.length))
      : destination.pathname === successPath;
    if (destination.origin !== new URL(action).origin || destination.search || destination.hash || !pathMatches) return failedSubmission;
    return { status: "success", path: destination.pathname } as const;
  } catch {
    return failedSubmission;
  }
}

export function TicketForm({ successMessage, successPath, create = false, children, ...props }: {
  successMessage: string; successPath: string; create?: boolean; children: ReactNode;
} & Omit<ComponentProps<"form">, "onSubmit" | "action"> & { action: string }) {
  const router = useRouter();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<{ status: "error" | "success"; message: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    submitting.current = true;
    setPending(true);
    setOutcome(null);
    const result = await submitTicketForm(form.action, data, successPath, create);
    setOutcome(result.status === "success" ? { status: "success", message: successMessage } : result);
    submitting.current = false;
    setPending(false);
    if (result.status === "success") {
      if (data.get("op") === "reply") {
        const body = form.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
        if (body) body.value = "";
      }
      if (create) router.push(result.path);
      else router.refresh();
    }
  }
  return <form {...props} method="POST" onSubmit={submit} aria-busy={pending}>
    <fieldset disabled={pending} className="m-0 min-w-0 space-y-3 border-0 p-0">{children}</fieldset>
    {pending && <p role="status" aria-live="polite" className="text-sm text-muted-foreground">Saving…</p>}
    {outcome && <FormStatus status={outcome.status}>{outcome.message}</FormStatus>}
  </form>;
}
