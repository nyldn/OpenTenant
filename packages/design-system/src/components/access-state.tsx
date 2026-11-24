import * as React from "react"
import { Alert, AlertDescription, AlertTitle } from "./ui/alert"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "./ui/empty"
import { Button } from "./ui/button"

export interface StateAction { label: string; href: string }
export interface AccessDeniedProps {
  state: "signed-out" | "forbidden"
  action: StateAction
  description?: string
}
/** Supply only an action the current actor is allowed to take. No authority is inferred here. */
export function AccessDenied({ state, action, description }: AccessDeniedProps) {
  return <Alert data-state={state}>
    <AlertTitle className="line-clamp-none"><h1>{state === "signed-out" ? "Sign in to continue" : "Access denied"}</h1></AlertTitle>
    <AlertDescription>
      <p>{description ?? (state === "signed-out" ? "Sign in to view this page." : "Your account does not have permission to view this page.")}</p>
      <Button asChild variant="outline"><a href={action.href}>{action.label}</a></Button>
    </AlertDescription>
  </Alert>
}
export interface EmptyStateProps {
  state: "empty" | "unavailable"
  heading: string
  description: string
  action: StateAction
}
export function EmptyState({ state, heading, description, action }: EmptyStateProps) {
  return <Empty data-state={state}>
    <EmptyHeader>
      <h1 className="text-lg font-semibold">{heading}</h1>
      {state === "unavailable" ? <Alert><AlertTitle>Currently unavailable</AlertTitle><AlertDescription>{description}</AlertDescription></Alert> : <EmptyDescription>{description}</EmptyDescription>}
    </EmptyHeader>
    <EmptyContent><Button asChild variant="outline"><a href={action.href}>{action.label}</a></Button></EmptyContent>
  </Empty>
}
