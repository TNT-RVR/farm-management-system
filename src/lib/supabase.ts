import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

// "Stay logged in": when off, the auth token lives in sessionStorage (cleared
// when the browser closes); when on (default), in localStorage (persists). The
// preference flag itself always lives in localStorage.
const STAY_KEY = 'stayLoggedIn'
export const setStayLoggedIn = (stay: boolean) => {
  try {
    localStorage.setItem(STAY_KEY, stay ? '1' : '0')
  } catch {
    /* ignore */
  }
}
const authStorage =
  typeof window === 'undefined'
    ? undefined
    : {
        getItem: (k: string) =>
          (localStorage.getItem(STAY_KEY) === '0' ? sessionStorage : localStorage).getItem(k),
        setItem: (k: string, v: string) => {
          const persist = localStorage.getItem(STAY_KEY) !== '0'
          ;(persist ? localStorage : sessionStorage).setItem(k, v)
          ;(persist ? sessionStorage : localStorage).removeItem(k) // avoid a stale copy
        },
        removeItem: (k: string) => {
          localStorage.removeItem(k)
          sessionStorage.removeItem(k)
        },
      }

// Typed as non-null for ergonomic use; ProtectedRoute blocks the app when
// isSupabaseConfigured is false, so no query runs against the dummy client.
export const supabase: SupabaseClient<Database> = createClient<Database>(
  url ?? 'http://not-configured.invalid',
  anonKey ?? 'not-configured',
  { auth: { storage: authStorage, persistSession: true, autoRefreshToken: true } },
)
