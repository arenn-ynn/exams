import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

export type Theme = 'light' | 'dark' | 'system'
export const ACCENTS = ['blue', 'purple', 'green', 'orange', 'pink', 'red', 'cyan'] as const
export type Accent = (typeof ACCENTS)[number]
export const ACCENT_SWATCH: Record<Accent, string> = {
  blue: '#2563eb', purple: '#7c3aed', green: '#15803d', orange: '#c2410c', pink: '#be185d', red: '#b91c1c', cyan: '#0e7490',
}

interface ThemeState { theme: Theme; accent: Accent; setTheme: (t: Theme) => void; setAccent: (a: Accent) => void }
const Ctx = createContext<ThemeState>(null as unknown as ThemeState)
export const useTheme = () => useContext(Ctx)

const read = <T extends string>(k: string, fallback: T, allowed: readonly string[]): T => {
  try { const v = localStorage.getItem(k); return v && allowed.includes(v) ? (v as T) : fallback } catch { return fallback }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [theme, setThemeState] = useState<Theme>(() => read('examina.theme', 'system', ['light', 'dark', 'system']))
  const [accent, setAccentState] = useState<Accent>(() => read('examina.accent', 'blue', ACCENTS))

  // Apply to <html>
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      document.documentElement.dataset.accent = accent
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme, accent])

  // Load the saved preference from the account so it follows the user across devices.
  const uid = user?.id
  useEffect(() => {
    if (!uid) return
    supabase.from('user_preferences').select('theme, accent').eq('user_id', uid).maybeSingle().then(({ data }) => {
      if (!data) return
      if (['light', 'dark', 'system'].includes(data.theme)) { setThemeState(data.theme as Theme); localStorage.setItem('examina.theme', data.theme) }
      if ((ACCENTS as readonly string[]).includes(data.accent)) { setAccentState(data.accent as Accent); localStorage.setItem('examina.accent', data.accent) }
    })
  }, [uid])

  const persist = useCallback((patch: { theme?: Theme; accent?: Accent }) => {
    if (uid) void supabase.from('user_preferences').upsert({ user_id: uid, ...patch, updated_at: new Date().toISOString() })
  }, [uid])
  const setTheme = useCallback((t: Theme) => { setThemeState(t); localStorage.setItem('examina.theme', t); persist({ theme: t }) }, [persist])
  const setAccent = useCallback((a: Accent) => { setAccentState(a); localStorage.setItem('examina.accent', a); persist({ accent: a }) }, [persist])

  return <Ctx.Provider value={{ theme, accent, setTheme, setAccent }}>{children}</Ctx.Provider>
}
