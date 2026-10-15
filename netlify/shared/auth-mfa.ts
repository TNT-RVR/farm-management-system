import type { SupabaseClient, User } from '@supabase/supabase-js'

/**
 * A person who turned on the authenticator must have entered its code in this
 * session (aal2) — the same rule the database applies (mfa_ok(), migration
 * 20261006220000). Server functions act with the service role, past RLS, so
 * without this a password-only token could still drive them.
 */
export function mfaSatisfied(user: Pick<User, 'factors'>, jwt: string): boolean {
  if (!(user.factors ?? []).some((f) => f.status === 'verified')) return true
  try {
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as { aal?: string }
    return claims.aal === 'aal2'
  } catch {
    return false
  }
}

/** sb.auth.getUser(jwt), but no user for a session that still owes its authenticator code. */
export async function getUserMfa(sb: SupabaseClient, jwt: string) {
  const r = await sb.auth.getUser(jwt)
  if (r.data.user && !mfaSatisfied(r.data.user, jwt)) {
    return { data: { user: null }, error: new Error('Enter your authenticator code first') }
  }
  return r
}
