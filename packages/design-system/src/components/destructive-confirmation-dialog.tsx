"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog"
import { Button } from "./ui/button"
import { FormStatus } from "./form-field"

export interface DestructiveConfirmationDialogProps {
  trigger: React.ReactElement
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => Promise<void> | void
  onSuccess?: () => void
}
/** A rejected confirmation stays open for retry. Cancel receives initial focus. */
export function DestructiveConfirmationDialog({ trigger, title, description, confirmLabel, cancelLabel = "Cancel", onConfirm, onSuccess }: DestructiveConfirmationDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState(false)
  const busy = React.useRef(false)
  const cancel = React.useRef<HTMLButtonElement>(null)
  async function confirm() {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError(false)
    try { await onConfirm(); setOpen(false); onSuccess?.() }
    catch { setError(true) }
    finally { busy.current = false; setPending(false) }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy.current) { setOpen(value); setError(false) } }}>
    <DialogTrigger asChild>{trigger}</DialogTrigger>
    <DialogContent role="alertdialog" aria-busy={pending} showCloseButton={false}
      onOpenAutoFocus={event => { event.preventDefault(); cancel.current?.focus() }}
      onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (pending) event.preventDefault() }}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      {error && <FormStatus status="error">The action couldn’t be completed. Please try again.</FormStatus>}
      {pending && <p role="status" aria-live="polite">Working…</p>}
      <DialogFooter>
        <Button ref={cancel} type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>{cancelLabel}</Button>
        <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>{pending ? "Working…" : confirmLabel}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
