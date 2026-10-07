import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

/**
 * Optional authenticator-app sign-in (TOTP), through Supabase Auth.
 *
 * Off until a person turns it on under Settings → My account → Sign-in
 * security. Once on, the database itself refuses that person's reads and
 * writes until the six-digit code is entered (mfa_ok(), migration
 * 20261006220000), so the screens here are the way in, not the lock.
 */

export type TotpFactor = { id: string; friendly_name?: string | null; status: string; created_at: string }

/** Is a code still owed for this session? True only for someone who set one up. */
export function useMfaGate(userId: string | null, sessionExpiresAt?: number) {
  return useQuery({
    enabled: Boolean(userId),
    // Per session (its expiry changes with every sign-in and refresh), so a
    // new sign-in never reuses the last one's answer. Not the token itself.
    queryKey: ['mfa-aal', userId, sessionExpiresAt ?? null],
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (error) throw error
      return { needsCode: data.nextLevel === 'aal2' && data.currentLevel !== 'aal2' }
    },
  })
}

export function useTotpFactors(userId: string | null) {
  return useQuery({
    enabled: Boolean(userId),
    queryKey: ['mfa-factors', userId],
    queryFn: async (): Promise<{ verified: TotpFactor[]; pending: TotpFactor[] }> => {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) throw error
      const all = (data.all ?? []).filter((f) => f.factor_type === 'totp') as unknown as TotpFactor[]
      return { verified: all.filter((f) => f.status === 'verified'), pending: all.filter((f) => f.status !== 'verified') }
    },
  })
}

/** Refresh everything that depends on the sign-in level after it changes. */
export function useMfaRefresh() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['mfa-aal'] })
    void qc.invalidateQueries({ queryKey: ['mfa-factors'] })
    // Reads that the database refused before the code now succeed.
    void qc.invalidateQueries()
  }
}

/** Check a code against the person's verified authenticator, raising the session to aal2. */
export async function verifyTotp(code: string): Promise<void> {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error
  const factor = (data.totp ?? []).find((f) => f.status === 'verified')
  if (!factor) throw new Error('No authenticator is set up on this account')
  const { error: vErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() })
  if (vErr) throw new Error(vErr.message.includes('Invalid') ? 'That code is wrong or has expired. Try the current one.' : vErr.message)
}

/** Start setting one up: a QR code to scan, and the secret to type in by hand. */
export async function startTotpEnrolment(): Promise<{ factorId: string; qr: string; secret: string }> {
  // An abandoned set-up leaves an unverified factor behind; clear it first.
  const { data: existing } = await supabase.auth.mfa.listFactors()
  for (const f of existing?.all ?? []) {
    if (f.factor_type === 'totp' && f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` })
  if (error) throw error
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret }
}

/** Finish set-up with the first code the app shows. */
export async function confirmTotpEnrolment(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
  if (error) throw new Error(error.message.includes('Invalid') ? 'That code didn’t match. Check the phone’s clock and try the current code.' : error.message)
}

export async function removeTotp(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) throw error
  // The session still says aal2; a refresh brings it back to what the account now needs.
  await supabase.auth.refreshSession()
}
