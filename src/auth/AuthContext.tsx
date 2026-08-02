// @refresh reset
import {
  createContext, useContext, useState, useEffect,
  useMemo, useCallback, type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store'
import type { Profile } from '@/types'

interface AuthContextValue {
  session:          Session | null
  profile:          Profile | null
  isLoading:        boolean
  isPendingApproval: boolean
  signIn:           (email: string, password: string) => Promise<string | null>
  signUp:           (email: string, password: string, fullName: string) => Promise<string | null>
  signInWithGoogle: () => Promise<string | null>
  signOut:          () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Supabase requests carry no timeout of their own, and a hung one during
// boot used to leave the app on the full-page spinner with no way out.
const PROFILE_TIMEOUT_MS = 6000
const SESSION_TIMEOUT_MS = 6000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session,   setSession]   = useState<Session | null>(null)
  const [profile,   setProfile]   = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (data) {
      setProfile(data as Profile)
      useStore.getState().setProfile(data as Profile)
      return data as Profile
    }
    return null
  }, [])

  /**
   * A session counts as established only once its profile is actually in
   * hand. Surfacing the session first (with the profile still loading in
   * the background) rendered the app shell with no identity — empty fields,
   * and the not-yet-approved check silently passing because it needs the
   * profile to say no. Not knowing who someone is has exactly one correct
   * outcome: the sign-in screen.
   */
  const establishSession = useCallback(async (nextSession: Session | null) => {
    const loadedProfile = nextSession
      ? await withTimeout(fetchProfile(nextSession.user.id), PROFILE_TIMEOUT_MS)
      : null

    if (nextSession && loadedProfile) {
      setSession(nextSession)
      return
    }

    setSession(null)
    setProfile(null)
    useStore.getState().setProfile(null)
  }, [fetchProfile])

  useEffect(() => {
    let settled = false

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        settled = true
        await establishSession(session)
        setIsLoading(false)
      }
    )

    // Fallback: if onAuthStateChange doesn't fire within 3 s (can happen with
    // some Supabase key formats), resolve auth manually from localStorage.
    const fallback = setTimeout(async () => {  // 800ms covers normal auth init latency
      if (settled) return
      try {
        const projectRef = new URL(import.meta.env.VITE_SUPABASE_URL as string).hostname.split('.')[0]
        const raw = localStorage.getItem(`sb-${projectRef}-auth-token`)
        const stored = raw ? JSON.parse(raw) : null

        if (stored?.access_token && stored?.refresh_token) {
          // Hand the stored tokens to the client rather than calling the
          // REST endpoints directly: setSession refreshes an expired access
          // token (they last an hour, so a phone opened once a day always
          // needs it) *and* installs the result into the client's in-memory
          // session. Refreshing by hand into localStorage did neither — the
          // client kept using the dead token, so every later query, the
          // profile fetch included, quietly failed.
          const result = await withTimeout(
            supabase.auth.setSession({
              access_token: stored.access_token,
              refresh_token: stored.refresh_token,
            }),
            SESSION_TIMEOUT_MS,
          )
          await establishSession(result?.data?.session ?? null)
        }
      } catch { /* silent */ }
      setIsLoading(false)
    }, 800)

    return () => {
      subscription.unsubscribe()
      clearTimeout(fallback)
    }
  }, [fetchProfile])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error?.message ?? null
  }, [])

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        // Must include the /NoJira/ base — otherwise the confirm link lands on the
        // domain root (no GitHub Pages site there) and 404s.
        emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}board`,
      },
    })
    return error?.message ?? null
  }, [])

  const signInWithGoogle = useCallback(async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}board`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
        skipBrowserRedirect: true,
      },
    })
    if (error) return error.message
    if (!data.url) return 'Google sign-in is not available for this project.'
    window.location.assign(data.url)
    return null
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const isPendingApproval = !!(session && profile && !profile.approved)

  const value = useMemo(
    () => ({ session, profile, isLoading, isPendingApproval, signIn, signUp, signInWithGoogle, signOut }),
    [session, profile, isLoading, isPendingApproval, signIn, signUp, signInWithGoogle, signOut]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuthContext() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider')
  return ctx
}
