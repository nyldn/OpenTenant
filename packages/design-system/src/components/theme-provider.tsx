"use client"

import { browserMatchMedia } from "@opentenant/platform-core/runtime-globals"
import { createContext, useContext, useEffect, useState } from "react"

type Theme = "dark" | "light" | "system"
type ThemeProviderState = { theme: Theme; setTheme: (t: Theme) => void }

const initial: ThemeProviderState = { theme: "dark", setTheme: () => null }
const ThemeProviderContext = createContext<ThemeProviderState>(initial)

export function ThemeProvider({
  children,
  defaultTheme = "dark",
  storageKey = "platform-ui-theme",
}: {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  )

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove("light", "dark")
    if (theme === "system") {
      const sys = browserMatchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      root.classList.add(sys)
      return
    }
    root.classList.add(theme)
  }, [theme])

  return (
    <ThemeProviderContext.Provider
      value={{ theme, setTheme: (t) => { localStorage.setItem(storageKey, t); setTheme(t) } }}
    >
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeProviderContext)
