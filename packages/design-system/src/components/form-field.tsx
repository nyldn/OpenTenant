"use client"

import * as React from "react"
import { Label } from "./ui/label"
import { Input } from "./ui/input"
import { Button } from "./ui/button"
import { Alert, AlertTitle, AlertDescription } from "./ui/alert"

export type FormOutcome =
  | { status: "success"; message: string }
  | { status: "error"; message: string; fieldErrors?: Readonly<Record<string, string>> }
export interface SharedFormProps extends Omit<React.ComponentProps<"form">, "onSubmit" | "action"> {
  onSubmit: (data: FormData) => FormOutcome | Promise<FormOutcome>
  submitLabel: string
  pendingLabel?: string
  retryLabel?: string
  disabled?: boolean
}
interface FieldContext {
  id: string
  pending: boolean
  disabled: boolean
  errors: Readonly<Record<string, string>>
}
const FormContext = React.createContext<FieldContext | null>(null)

/** Keeps mounted, uncontrolled fields on failure; passwords are always cleared.
 * The submit callback must return safe user-facing messages, never API/driver errors.
 */
export function SharedForm({ onSubmit, submitLabel, pendingLabel = "Saving…", retryLabel = "Try again", disabled = false, children, id, ...props }: SharedFormProps) {
  const generatedId = React.useId()
  const formId = id ?? generatedId
  const [pending, setPending] = React.useState(false)
  const submitting = React.useRef(false)
  const [outcome, setOutcome] = React.useState<FormOutcome | null>(null)
  const summary = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { if (outcome?.status === "error") summary.current?.focus() }, [outcome])
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || disabled) return
    const form = event.currentTarget
    const data = new FormData(form)
    submitting.current = true
    setPending(true)
    setOutcome(null)
    try {
      setOutcome(await onSubmit(data))
    } catch {
      setOutcome({ status: "error", message: "We couldn’t save your changes. Please try again." })
    } finally {
      for (const input of form.querySelectorAll<HTMLInputElement>('input[type="password"]')) input.value = ""
      submitting.current = false
      setPending(false)
    }
  }
  const errors = outcome?.status === "error" ? outcome.fieldErrors ?? {} : {}
  return <FormContext.Provider value={{ id: formId, pending, disabled, errors }}>
    <form {...props} id={formId} onSubmit={submit} aria-busy={pending}>
      {outcome?.status === "error" && <Alert ref={summary} tabIndex={-1} variant="destructive" aria-labelledby={`${formId}-errors`}>
        <AlertTitle id={`${formId}-errors`}>Check your changes</AlertTitle>
        <AlertDescription><p>{outcome.message}</p>
          {Object.entries(errors).length > 0 && <ul>{Object.entries(errors).map(([name, message]) => <li key={name}><a className="inline-flex min-h-11 items-center underline" href={`#${formId}-${name}`}>{message}</a></li>)}</ul>}
        </AlertDescription>
      </Alert>}
      <fieldset disabled={disabled || pending} className="m-0 min-w-0 space-y-4 border-0 p-0">
        {children}
        <Button type="submit" disabled={disabled || pending}>{pending ? pendingLabel : outcome?.status === "error" ? retryLabel : submitLabel}</Button>
      </fieldset>
      {pending && <p role="status" aria-live="polite">{pendingLabel}</p>}
      {outcome?.status === "success" && <FormStatus status="success">{outcome.message}</FormStatus>}
    </form>
  </FormContext.Provider>
}

export interface FieldControlProps {
  id: string
  name: string
  disabled: boolean
  "aria-describedby"?: string
  "aria-invalid": boolean
  "aria-busy": boolean
}
export interface FormFieldProps {
  name: string
  label: React.ReactNode
  help?: React.ReactNode
  error?: string
  disabled?: boolean
  pending?: boolean
  children: (props: FieldControlProps) => React.ReactNode
}
export function FormField({ name, label, help, error, disabled = false, pending = false, children }: FormFieldProps) {
  const generatedId = React.useId()
  const form = React.useContext(FormContext)
  const id = form ? `${form.id}-${name}` : generatedId
  const message = error ?? form?.errors[name]
  const busy = pending || Boolean(form?.pending)
  const description = [help ? `${id}-help` : null, message ? `${id}-error` : null].filter(Boolean).join(" ") || undefined
  return <div className="min-w-0 space-y-2" data-slot="form-field">
    <Label htmlFor={id}>{label}</Label>
    {children({ id, name, disabled: disabled || busy || Boolean(form?.disabled), "aria-invalid": Boolean(message), "aria-describedby": description, "aria-busy": busy })}
    {help && <p id={`${id}-help`} className="text-sm text-muted-foreground">{help}</p>}
    {message && <p id={`${id}-error`} role="alert" className="text-sm text-danger-text">{message}</p>}
  </div>
}
export type FormInputProps = Omit<React.ComponentProps<typeof Input>, "id" | "value" | "name" | "children"> & Omit<FormFieldProps, "children">
/** Uncontrolled by contract so safe input survives retry and passwords can be cleared. */
export function FormInput({ name, label, help, error, pending, disabled, ...props }: FormInputProps) {
  return <FormField {...{ name, label, help, error, pending, disabled }}>{control => <Input {...props} {...control} />}</FormField>
}
export function FormStatus({ status, children }: { status: "error" | "success"; children: React.ReactNode }) {
  return <Alert variant={status === "error" ? "destructive" : "default"} role={status === "error" ? "alert" : "status"} aria-live={status === "error" ? "assertive" : "polite"}>
    <AlertDescription className={status === "success" ? "text-success-text" : "text-danger-text"}>{children}</AlertDescription>
  </Alert>
}
