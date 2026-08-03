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
const PROFILE_ATTEMPTS = 3
const PROFILE_RETRY_MS = 400

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
    let loadedProfile: Profile | null = null

    if (nextSession) {
      // Retry briefly: on a first-ever Google sign-in the profile row is
      // created by a database trigger, and we can arrive here before it
      // exists. Without this, a brand-new account bounced straight back to
      // the sign-in screen.
      for (let attempt = 0; attempt < PROFILE_ATTEMPTS && !loadedProfile; attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, PROFILE_RETRY_MS))
        loadedProfile = await withTimeout(fetchProfile(nextSession.user.id), PROFILE_TIMEOUT_MS)
      }
    }

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
        // Ask the client what it already has first. That covers a sign-in
        // this fallback must not touch: returning from Google, the code
        // exchange may still be in flight, and writing the *stored* (old)
        // tokens over it killed the fresh session and bounced the person
        // straight back to the sign-in screen.
        const existing = await withTimeout(supabase.auth.getSession(), SESSION_TIMEOUT_MS)
        let nextSession = existing?.data?.session ?? null

        // A callback still carrying its code/token in the URL means a
        // sign-in is mid-flight; the stored tokens below are the *previous*
        // session and must not be installed over it.
        const oauthCallbackInFlight = /[?&#](code|access_token)=/.test(window.location.href)

        if (!nextSession && !oauthCallbackInFlight) {
          const projectRef = new URL(import.meta.env.VITE_SUPABASE_URL as string).hostname.split('.')[0]
          const raw = localStorage.getItem(`sb-${projectRef}-auth-token`)
          const stored = raw ? JSON.parse(raw) : null

          if (stored?.access_token && stored?.refresh_token) {
            // Hand the stored tokens to the client rather than calling the
            // REST endpoints directly: setSession refreshes an expired
            // access token (they last an hour, so a phone opened once a day
            // always needs it) *and* installs the result into the client's
            // in-memory session. Refreshing by hand into localStorage did
            // neither — the client kept using the dead token, so every later
            // query, the profile fetch included, quietly failed.
            const result = await withTimeout(
              supabase.auth.setSession({
                access_token: stored.access_token,
                refresh_token: stored.refresh_token,
              }),
              SESSION_TIMEOUT_MS,
            )
            nextSession = result?.data?.session ?? null
          }
        }

        // onAuthStateChange may have landed while we were awaiting; it owns
        // the outcome in that case, so don't overwrite what it just set.
        if (!settled && nextSession) await establishSession(nextSession)
      } catch { /* silent */ }
      if (!settled) setIsLoading(false)
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
