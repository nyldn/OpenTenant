import { browserWidth, browserMatchMedia } from "@opentenant/platform-core/runtime-globals"
import * as React from "react"

const MOBILE_BREAKPOINT = 768

function getIsMobile() {
  return (browserWidth() ?? MOBILE_BREAKPOINT) < MOBILE_BREAKPOINT
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(() => getIsMobile())

  React.useEffect(() => {
    const mql = browserMatchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(getIsMobile())
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
