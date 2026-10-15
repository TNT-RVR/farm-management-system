// Google Drive, for the report backup (Sam, 7 Oct 2026). The app only ever
// sees the files it made itself: the scope is drive.file, so it cannot read
// anything else in the Drive. The folder "RVR Management App" and everything
// in it are created by the app.
//   authorize  https://accounts.google.com/o/oauth2/v2/auth
//   token      https://oauth2.googleapis.com/token
// Access tokens live an hour; the refresh token is kept (encrypted) and only
// ever used here. The browser gets a fresh access token to upload with.
import type { SupabaseClient } from '@supabase/supabase-js'
import { admin, decryptToken, encryptToken, json, mfaSatisfied, siteUrl } from './_jd.mts'

export { admin, decryptToken, encryptToken, json, siteUrl }

export const GD_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GD_TOKEN = 'https://oauth2.googleapis.com/token'
export const GD_SCOPES = 'https://www.googleapis.com/auth/drive.file'

// Registered on the Google Cloud OAuth client exactly as this.
export const gdRedirectUri = () => `${siteUrl()}/api/google-drive-callback`

export function gdConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/** The signed-in person, if they may see the books: the backup holds the finance reports. */
export async function requireFinance(req: Request, sb: SupabaseClient): Promise<string | null> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const { data } = await sb.auth.getUser(jwt)
  if (!data.user || !mfaSatisfied(data.user, jwt)) return null
  const { data: profile } = await sb.from('users').select('active, is_owner, finance_access').eq('id', data.user.id).single()
  if (!profile?.active || !(profile.is_owner || profile.finance_access)) return null
  return data.user.id
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number }

export async function gdTokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const cfg = gdConfig()
  if (!cfg) throw new Error('Google Drive keys are not set')
  const res = await fetch(GD_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString(),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Google token request failed (${res.status}): ${text.slice(0, 300)}`)
  return JSON.parse(text) as TokenResponse
}

/** A live access token: the stored one while it has five minutes left, else a refreshed one. */
export async function gdAccess(sb: SupabaseClient): Promise<{ token: string; expiresAt: string }> {
  const { data: acct } = await sb.from('integration_accounts').select('*').eq('provider', 'google_drive').single()
  if (!acct || acct.status !== 'connected' || !acct.refresh_token) throw new Error('Google Drive is not connected')
  const left = acct.token_expires_at ? new Date(acct.token_expires_at).getTime() - Date.now() : 0
  if (acct.access_token && left > 5 * 60_000) return { token: (await decryptToken(acct.access_token))!, expiresAt: acct.token_expires_at }
  const refresh = await decryptToken(acct.refresh_token)
  if (!refresh) throw new Error('No refresh token — connect Google Drive again')
  let tok: TokenResponse
  try {
    tok = await gdTokenRequest({ grant_type: 'refresh_token', refresh_token: refresh })
  } catch (e) {
    // invalid_grant: revoked from the Google account, or the consent screen
    // still in Testing (its tokens die after 7 days). Only a person can fix it.
    await sb
      .from('integration_accounts')
      .update({ status: 'error', last_error: `Connect Google Drive again: ${(e as Error).message.slice(0, 200)}`, updated_at: new Date().toISOString() })
      .eq('provider', 'google_drive')
    throw e
  }
  const expiresAt = new Date(Date.now() + tok.expires_in * 1000).toISOString()
  await sb
    .from('integration_accounts')
    .update({
      access_token: await encryptToken(tok.access_token),
      ...(tok.refresh_token ? { refresh_token: await encryptToken(tok.refresh_token) } : {}),
      token_expires_at: expiresAt,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('provider', 'google_drive')
  return { token: tok.access_token, expiresAt }
}
