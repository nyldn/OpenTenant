import { ThemeProvider } from "@opentenant/design-system"
import { TooltipProvider } from "@opentenant/design-system"
import { AssessmentApp } from "./AssessmentApp"

export default function AssessmentSurface() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="assessment-ui-theme">
      <TooltipProvider>
        <AssessmentApp />
      </TooltipProvider>
    </ThemeProvider>
  )
}
