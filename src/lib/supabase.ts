import { createClient } from '@supabase/supabase-js'

const url  = import.meta.env.VITE_SUPABASE_URL  as string
const akey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !akey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

export const supabase = createClient(url, akey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // supabase-js serializes auth calls (getSession/setSession/refresh)
    // through navigator.locks by default. Confirmed via an on-screen trace
    // on a real device (Pixel/Chrome): getSession() and setSession() both
    // hung for the full timeout, twice in a row, including right after a
    // clean return from a Google OAuth redirect with a valid token in the
    // URL — the signature of a stuck lock, not a slow network. This app is
    // single-tab-per-session; there's nothing to serialize against, so the
    // lock is replaced with a plain passthrough instead of chasing the hang
    // with longer timeouts.
    lock: async (_name, _acquireTimeout, fn) => fn(),
  },
})
