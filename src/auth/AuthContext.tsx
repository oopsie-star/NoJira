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
    }
  }, [])

  useEffect(() => {
    let settled = false

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        settled = true
        setSession(session)
        setIsLoading(false)  // unblock UI immediately, profile loads in background
        if (session) {
          fetchProfile(session.user.id)  // fire-and-forget, updates profile when ready
        } else {
          setProfile(null)
          useStore.getState().setProfile(null)
        }
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
        if (stored?.access_token && stored.expires_at > Date.now() / 1000) {
          const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/user`, {
            headers: {
              apikey:        import.meta.env.VITE_SUPABASE_ANON_KEY as string,
              Authorization: `Bearer ${stored.access_token}`,
            },
          })
          if (res.ok) {
            const user = await res.json()
            await fetchProfile(user.id)
            setSession({ access_token: stored.access_token, user } as any)
          }
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
