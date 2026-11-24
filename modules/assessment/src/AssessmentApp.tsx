"use client"

import { AssessmentShell } from "./assessment-shell"
import { AssessmentProvider } from "./store"

export function AssessmentApp() {
  return (
    <AssessmentProvider>
      <AssessmentShell />
    </AssessmentProvider>
  )
}
