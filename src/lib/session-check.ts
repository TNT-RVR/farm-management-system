import { supabase } from './supabase'

/**
 * Is this device still signed in as far as the login server is concerned?
 *
 * A token the database takes and the login server does not (Sam, 14 Nov
 * 2026: Ask the app said "Not authorised" while every page around it worked).
 * Signing out used to end the session on EVERY device, because supabase-js
 * signs out globally unless told otherwise, and the other devices never heard
 * about it: they still held an access token, and this project's tokens last a
 * week. The database only checks a token's signature and its expiry, so those
 * devices went on reading and writing as if nothing had happened — while the
 * site's own functions (/api, 37 of them) check the session against the login
 * server, so every one of them refused. The app looked signed in and only the
 * things that need a function were broken, for up to a week.
 *
 * Signing out is this device only now (lib/auth.tsx), so no new token is
 * orphaned; this is what clears the ones that already were, and what catches
 * an account closed from the Supabase side. Signing out somewhere else was
 * never how an account gets taken away in any case — an admin turns the person
 * off (users.active), which the database itself enforces.
 *
 * Only a straight refusal counts. A request that fails for want of signal must
 * leave the session alone: out in a field with no bars, throwing someone to a
 * login screen they cannot get past puts the saved data they came for behind
 * it. Same reasoning as onAuthStateChange in lib/auth.tsx.
 */
export async function sessionRefused(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false
  const { error } = await supabase.auth.getUser()
  const status = (error as { status?: number } | null | undefined)?.status
  return status === 401 || status === 403
}

/** Long enough that coming back to the tab is not a round trip every time. */
const RECHECK_MS = 10 * 60_000
let last = 0

/**
 * Sign this device out if the login server has stopped knowing it. Called on
 * load, when a tab is looked at again, and whenever a function answers 401 —
 * a phone or a shop screen can sit on one page for days, which is longer than
 * a token that nothing will refresh for a week.
 *
 * `force` skips the wait, for the 401 case: that is already the server saying
 * no, so there is nothing to spare.
 */
export async function dropRefusedSession(force = false): Promise<boolean> {
  if (!force && Date.now() - last < RECHECK_MS) return false
  last = Date.now()
  if (!(await sessionRefused())) return false
  await supabase.auth.signOut({ scope: 'local' })
  return true
}
