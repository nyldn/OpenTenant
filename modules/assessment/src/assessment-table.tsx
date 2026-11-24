"use client"

import { useEffect, useRef, type ComponentProps } from "react"
import { Table } from "@opentenant/design-system"

/** Name and focus the shared Table's actual scroll container only when it overflows. */
export function AssessmentTable({ label, ...props }: ComponentProps<typeof Table> & { label: string }) {
  const table = useRef<HTMLTableElement>(null)
  useEffect(() => {
    const element = table.current
    const container = element?.parentElement
    if (!element || !container) return
    const refresh = () => {
      const overflow = container.scrollWidth > container.clientWidth + 1
      if (overflow) {
        container.setAttribute("role", "region")
        container.setAttribute("aria-label", label)
        container.setAttribute("tabindex", "0")
        container.classList.add("focus-visible:outline-2", "focus-visible:outline-ring", "focus-visible:outline-offset-2")
      } else {
        container.removeAttribute("role")
        container.removeAttribute("aria-label")
        container.removeAttribute("tabindex")
      }
    }
    refresh()
    const observer = new ResizeObserver(refresh)
    observer.observe(container)
    observer.observe(element)
    return () => observer.disconnect()
  }, [label])
  return <Table ref={table} {...props} />
}
