import { createClient } from '@supabase/supabase-js'

/**
 * The service-role Supabase client for functions. Reads the environment at
 * call time, so it sees whatever hydrateSecrets() has filled in.
 */
export function admin() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

/** The service client, or null when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. */
export function adminOrNull(): ReturnType<typeof admin> | null {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return admin()
}
