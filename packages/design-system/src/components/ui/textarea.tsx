import * as React from "react"

import { cn } from "../../lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "platform-ui-editor-text flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-background text-foreground px-2.5 py-1.5 shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-ring  dark:aria-invalid:ring-ring",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
