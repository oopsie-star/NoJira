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
  },
})
