import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'qira-theme'

/**
 * Light unless the person asked otherwise — deliberately NOT following the OS.
 * Dark mode was requested by a few people, not the team, and flipping everyone
 * whose laptop happens to be in dark mode would be a change nobody asked for.
 */
export const DEFAULT_THEME: Theme = 'light'

export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'dark' || stored === 'light' ? stored : DEFAULT_THEME
  } catch {
    // Private mode / blocked storage — the default is a fine answer.
    return DEFAULT_THEME
  }
}

/**
 * The single place the theme becomes visible: one class on <html>, which every
 * colour variable in index.css hangs off. Also sets color-scheme, so native
 * chrome — scrollbars, form controls, the caret — follows along instead of
 * staying stubbornly light.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Losing the preference across reloads beats failing the toggle.
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    storeTheme(next)
    setThemeState(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      storeTheme(next)
      return next
    })
  }, [])

  return { theme, setTheme, toggleTheme }
}
