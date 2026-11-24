import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { FormField, FormInput, FormStatus, SharedForm } from "./form-field"
import { AccessDenied, EmptyState } from "./access-state"
import { Button } from "./ui/button"
import { Input } from "./ui/input"

describe("shared field composition", () => {
  it("links a visible label, help and alert error to a stable control", () => {
    const html = renderToStaticMarkup(<SharedForm id="profile" onSubmit={() => ({ status: "success", message: "Saved" })} submitLabel="Save">
      <FormInput name="email" label="Email" help="Use your work address" error="Check your email" type="email" defaultValue="person@example.test" />
      <FormField name="note" label="Note" disabled>{props => <Input {...props} />}</FormField>
    </SharedForm>)
    expect(html).toContain('for="profile-email"')
    expect(html).toContain('id="profile-email"')
    expect(html).toContain('aria-describedby="profile-email-help profile-email-error"')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('id="profile-email-error" role="alert"')
    expect(html).toContain('id="profile-note" disabled=""')
    expect(html).toContain('value="person@example.test"')
  })
  it("announces success politely and errors immediately", () => {
    expect(renderToStaticMarkup(<FormStatus status="success">Saved</FormStatus>)).toContain('role="status"')
    expect(renderToStaticMarkup(<FormStatus status="success">Saved</FormStatus>)).toContain('aria-live="polite"')
    expect(renderToStaticMarkup(<FormStatus status="error">Try again</FormStatus>)).toContain('role="alert"')
  })
  it("exposes pending and disabled state to custom controls", () => {
    const html = renderToStaticMarkup(<FormField name="custom" label="Choice" pending>{props => <Input {...props} />}</FormField>)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('disabled=""')
  })
})
describe("access and data states", () => {
  it("distinguishes signed-out, forbidden, unavailable and genuinely empty with headings and allowed actions", () => {
    const action = { label: "Go home", href: "/" }
    for (const state of ["signed-out", "forbidden"] as const) {
      const html = renderToStaticMarkup(<AccessDenied state={state} action={action} />)
      expect(html).toContain(`data-state="${state}"`)
      expect(html).toContain(state === "signed-out" ? "Sign in to continue" : "Access denied")
      expect(html).toContain("<h1>")
      expect(html).toContain('href="/"')
    }
    for (const state of ["empty", "unavailable"] as const) {
      const html = renderToStaticMarkup(<EmptyState state={state} heading="Tickets" description="Details" action={action} />)
      expect(html).toContain(`data-state="${state}"`)
      expect(html).toContain("<h1")
      expect(html).toContain('href="/"')
      expect(html.includes("Currently unavailable")).toBe(state === "unavailable")
    }
  })
})
describe("primitive defaults", () => {
  it("keeps compact buttons at the shared touch target and uses paired destructive text", () => {
    for (const size of ["default", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"] as const) {
      const html = renderToStaticMarkup(<Button size={size} variant="destructive">Delete</Button>)
      expect(html).toContain("min-h-11")
      expect(html).toContain("text-destructive-foreground")
      expect(html).not.toContain("text-white")
      expect(html).not.toContain("disabled:opacity")
    }
  })
})
