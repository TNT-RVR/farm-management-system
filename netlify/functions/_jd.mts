// Shared John Deere Operations Center helpers for the OAuth + sync functions.
// Endpoints and scopes are from developer.deere.com (read 2026-07-17):
//   authorize  https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/authorize
//   token      https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/token
//   API base   https://api.deere.com   (sandbox: https://sandboxapi.deere.com)
//   media type application/vnd.deere.axiom.v3+json
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { mfaSatisfied } from '../shared/auth-mfa.ts'

export { mfaSatisfied }

export const JD_AUTHORIZE = 'https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/authorize'
export const JD_TOKEN = 'https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/token'
// Scopes, as John Deere describes them on its own consent screen (read there,
// 2026-08-06 — do NOT infer these from the names):
//   org1   view organization staff, operators, partners
//   ag1    view products, field list, field locations, boundaries, tracks
//   ag2    view OPERATIONAL FIELD RESULTS  <- field operations / as-applied
//   eq1    view equipment details, alerts, and maintenance plans
//   work1  view Work and Crop Plans
//
// ag3 is deliberately NOT requested: its consent text is "edit and delete
// locations, products, and production data". It is a write/delete scope, it adds
// nothing we read, and asking for it would contradict the read-only use case the
// access request was granted on. Everything this app does is a GET.
//
// Scopes are fixed at authorisation time, so changing this list means
// disconnecting and reconnecting. Overridable by env because /authorize rejects
// the whole request if it doesn't recognise one.
export const JD_SCOPES = process.env.JD_SCOPES ?? 'ag1 ag2 eq1 work1 org1 offline_access'
export const JD_ACCEPT = 'application/vnd.deere.axiom.v3+json'

// Roles with manager-level access. Admin is a superset of manager, so any
// check that means "can manage the farm" must accept both — comparing to
// 'manager' alone silently locks admins out of every server endpoint.
export const MANAGER_ROLES = ['manager', 'admin']

// Not Netlify's own URL variable: that becomes a custom domain the day one is
// added, and the OAuth redirect registered with Deere and Lindsay must not move
// with it.
export const siteUrl = () => (process.env.SITE_URL || 'https://your-farm.netlify.app').replace(/\/$/, '')
export const jdRedirectUri = () => `${siteUrl()}/api/jd-callback`

// After OAuth, John Deere still requires the user to pick which organizations
// this application may see. Until they do, /platform/organizations returns the
// orgs but each carries a `connections` link and every data call comes back
// empty — the classic "connected but no data" trap. Docs:
// developer.deere.com/dev-docs/connection-management
export const JD_CONNECTIONS = 'https://connections.deere.com/connections'
export function jdConnectionsUrl(clientId: string, redirectUri: string): string {
  return `${JD_CONNECTIONS}/${clientId}/select-organizations?redirect_uri=${encodeURIComponent(redirectUri)}`
}

export type JdOrg = {
  id?: string
  name?: string
  links?: { rel?: string; uri?: string }[]
}

/**
 * The connections URL to send the user to, or null when every org is already
 * shared with us. Prefers the `connections` link John Deere hands back (HATEOAS)
 * and falls back to the documented template.
 */
export function jdConnectionsRedirect(
  orgs: JdOrg[],
  clientId: string,
  redirectUri: string,
): string | null {
  const link = orgs
    .flatMap((o) => o.links ?? [])
    .find((l) => l.rel?.toLowerCase() === 'connections' && l.uri)
  // No link means every org is already shared with us — UNLESS there are no
  // orgs at all, which is the "connected but nothing selected" state the
  // documented template exists to get the user out of.
  if (!link) return orgs.length === 0 ? jdConnectionsUrl(clientId, redirectUri) : null
  const uri = link.uri!
  // Deere's own link usually omits redirect_uri; add ours so the user comes back.
  const sep = uri.includes('?') ? '&' : '?'
  return uri.includes('redirect_uri=')
    ? uri
    : `${uri}${sep}redirect_uri=${encodeURIComponent(redirectUri)}`
}

export function jdApiBase(): string {
  return process.env.JD_SANDBOX === 'true' ? 'https://sandboxapi.deere.com' : 'https://api.deere.com'
}

export function jdConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.JD_CLIENT_ID
  const clientSecret = process.env.JD_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export function admin(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

// ---------------------------------------------------------------------------
// Token encryption. The AES-256-GCM key lives in Netlify env (TOKEN_ENC_KEY),
// never in the database, so a DB dump can't reveal OAuth tokens. Values are
// tagged `enc:v1:` so decrypt() knows whether to decrypt (handles legacy
// plaintext + key rotation). No key set → passthrough (dev / not-yet-hardened).
// ---------------------------------------------------------------------------
const ENC_PREFIX = 'enc:v1:'

async function encKey(): Promise<CryptoKey | null> {
  const b64 = process.env.TOKEN_ENC_KEY
  if (!b64) return null
  const raw = Buffer.from(b64, 'base64')
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptToken(plain: string | null | undefined): Promise<string | null> {
  if (!plain) return plain ?? null
  const key = await encKey()
  if (!key) return plain
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)),
  )
  const combined = new Uint8Array(iv.length + ct.length)
  combined.set(iv)
  combined.set(ct, iv.length)
  return ENC_PREFIX + Buffer.from(combined).toString('base64')
}

export async function decryptToken(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return stored ?? null
  if (!stored.startsWith(ENC_PREFIX)) return stored // legacy plaintext
  const key = await encKey()
  if (!key) throw new Error('TOKEN_ENC_KEY is missing but a token is encrypted')
  const combined = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64')
  const iv = combined.subarray(0, 12)
  const ct = combined.subarray(12)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(pt)
}

/** Verify the bearer JWT belongs to an active manager. Returns the user id or null. */
export async function requireManager(req: Request, sb: SupabaseClient): Promise<string | null> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const { data } = await sb.auth.getUser(jwt)
  if (!data.user || !mfaSatisfied(data.user, jwt)) return null
  const { data: profile } = await sb
    .from('users')
    .select('role, active')
    .eq('id', data.user.id)
    .single()
  // Admins are managers plus user administration — mirrors is_manager() in the DB.
  if (!profile || !MANAGER_ROLES.includes(profile.role) || !profile.active) return null
  return data.user.id
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Exchange an authorization code (or refresh token) for tokens. */
export async function jdTokenRequest(
  params: Record<string, string>,
  clientId: string,
  clientSecret: string,
): Promise<{
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(JD_TOKEN, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params).toString(),
  })
  if (!res.ok) {
    throw new Error(`JD token request failed (${res.status}): ${await res.text()}`)
  }
  return res.json()
}

/** Get a valid access token, refreshing if it expires within 5 minutes. */
export async function jdAccessToken(sb: SupabaseClient): Promise<string> {
  const { data: acct } = await sb
    .from('integration_accounts')
    .select('*')
    .eq('provider', 'john_deere')
    .single()
  if (!acct || acct.status !== 'connected' || !acct.access_token) {
    throw new Error('John Deere is not connected')
  }
  const expiresSoon =
    !acct.token_expires_at || new Date(acct.token_expires_at).getTime() - Date.now() < 5 * 60 * 1000
  if (!expiresSoon) return (await decryptToken(acct.access_token))!

  const cfg = jdConfig()
  if (!cfg) throw new Error('John Deere app not configured')
  const refresh = await decryptToken(acct.refresh_token)
  if (!refresh) throw new Error('No refresh token — reconnect John Deere')
  const tok = await jdTokenRequest(
    { grant_type: 'refresh_token', refresh_token: refresh },
    cfg.clientId,
    cfg.clientSecret,
  )
  await sb
    .from('integration_accounts')
    .update({
      access_token: await encryptToken(tok.access_token),
      refresh_token: await encryptToken(tok.refresh_token ?? refresh),
      token_expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('provider', 'john_deere')
  return tok.access_token
}

/** GET a JD API URL (absolute or path) with auth + axiom media type. */
export async function jdGet<T = unknown>(token: string, urlOrPath: string): Promise<T> {
  const url = urlOrPath.startsWith('http') ? urlOrPath : `${jdApiBase()}${urlOrPath}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: JD_ACCEPT },
  })
  if (!res.ok) throw new Error(`JD GET ${url} failed (${res.status}): ${await res.text()}`)
  return res.json() as Promise<T>
}
