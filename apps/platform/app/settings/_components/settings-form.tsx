"use client";

import { useEffect, useRef, useState, type ReactNode, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, FormField, FormStatus, Input, Textarea, type FormOutcome } from "@opentenant/design-system";

/** Routine forms retain safe fields and restore the submitting control on errors. */
export function SettingsForm({ endpoint, submitLabel, children, className = "mt-4 space-y-4", fallbackPath }: {
  endpoint: string; submitLabel: string; children: ReactNode; className?: string; fallbackPath?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<FormOutcome | null>(null);
  const submitting = useRef(false);
  const focus = useRef<HTMLElement | null>(null);
  useEffect(() => { if (outcome?.status === "error") focus.current?.focus(); }, [outcome]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    focus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    submitting.current = true;
    setPending(true); setOutcome(null);
    try {
      const result = await saveSettings(endpoint, data, fallbackPath);
      setOutcome(result);
      if (result.status === "success") router.refresh();
    } catch {
      setOutcome({ status: "error", message: "Could not save changes. Check your connection and try again." });
    } finally {
      for (const input of form.querySelectorAll<HTMLInputElement>('input[type="password"]')) input.value = "";
      submitting.current = false; setPending(false);
    }
  }
  return <form method="post" action={endpoint} onSubmit={submit} aria-busy={pending} className={`min-w-0 w-full ${className}`}>
    <fieldset disabled={pending} className="m-0 min-w-0 space-y-4 border-0 p-0">
      {children}
      <Button type="submit" className="max-w-full whitespace-normal">{submitLabel}</Button>
    </fieldset>
    {pending ? <p role="status">Saving…</p> : null}
    {outcome ? <FormStatus status={outcome.status}>{outcome.message}</FormStatus> : null}
  </form>;
}

export interface SettingsField {
  name: string; label: string; value?: string | number; disabled?: boolean; help?: string;
  maxLength?: number; type?: string; required?: boolean; min?: number; max?: number; pattern?: string;
}
export function SettingsInput({ value, name, label, disabled, help, ...input }: SettingsField) {
  return <FormField name={name} label={label} disabled={disabled} help={help}>
    {control => <Input {...input} {...control} defaultValue={value} className="w-full min-w-0" />}
  </FormField>;
}
export function SettingsNote({ name, label, value }: { name: string; label: string; value?: string | null }) {
  return <FormField name={name} label={label}>{control => <Textarea {...control} defaultValue={value ?? ""} maxLength={500} rows={3} className="w-full min-w-0" />}</FormField>;
}
export function SettingsSelect({ name, label, value, disabled, children }: {
  name: string; label: string; value: string; disabled?: boolean; children: ReactNode;
}) {
  return <FormField name={name} label={label} disabled={disabled} help={disabled ? "Locked by platform policy." : undefined}>
    {control => <select {...control} defaultValue={value} className="min-h-11 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground">{children}</select>}
  </FormField>;
}

async function saveSettings(endpoint: string, data: FormData, fallbackPath?: string): Promise<FormOutcome> {
  const response = await fetch(endpoint, { method: "POST", body: data, headers: { Accept: "application/json" } });
  if (response.headers.get("content-type")?.includes("application/json")) {
    const result = await response.json() as FormOutcome;
    if ((result.status !== "success" && result.status !== "error") || (result.status === "success" && !response.ok)) throw new Error("Invalid outcome");
    return result;
  }
  const destination = new URL(response.url);
  if (!response.ok || !fallbackPath || destination.pathname !== fallbackPath || destination.searchParams.has("error")) throw new Error("Save failed");
  return { status: "success", message: "Settings saved." };
}
