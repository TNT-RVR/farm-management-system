// Shared QuickBooks Online helpers. One-way: the app reads the books, never writes.
//   authorize  https://appcenter.intuit.com/connect/oauth2           (auth code)
//   token      https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer
//   revoke     https://developer.api.intuit.com/v2/oauth2/tokens/revoke
// (all three from Intuit's discovery documents, the same for sandbox and
// production — only the API host differs.)
//
// Access tokens live an hour. Refresh tokens ROTATE: every refresh can hand
// back a new one, and the old one stops working once the new one is used, so
// the new one must be saved every time — losing it means reconnecting.
import type { SupabaseClient } from '@supabase/supabase-js'
import { admin, decryptToken, encryptToken, json, mfaSatisfied, siteUrl } from './_jd.mts'

export { admin, decryptToken, encryptToken, json }

export const QB_AUTHORIZE = 'https://appcenter.intuit.com/connect/oauth2'
export const QB_TOKEN = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
export const QB_REVOKE = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'
export const QB_SCOPES = 'com.intuit.quickbooks.accounting'
// Intuit retired minor versions 1–74 in 2025; 75 is the floor.
export const QB_MINOR_VERSION = '75'

// Registered on the Intuit app exactly as this; netlify.toml routes it to quickbooks-callback.
export const qbRedirectUri = () => `${siteUrl()}/api/quickbooks/callback`

export type QbEnvironment = 'sandbox' | 'production'

/**
 * The real books. Sam dropped the sandbox on 7 Oct 2026 (production keys
 * only), so Farm setup no longer asks; QUICKBOOKS_ENVIRONMENT=sandbox in
 * Netlify still points a test install at Intuit's sample company.
 */
export const qbEnvironment = (): QbEnvironment =>
  (process.env.QUICKBOOKS_ENVIRONMENT ?? '').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'production'

export const qbApiBase = (env: QbEnvironment = qbEnvironment()) =>
  env === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com'

export function qbConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

/**
 * The signed-in person, if they may see the books (an owner, or finance
 * access — the CPA). Not managers as such: connecting QuickBooks hands the
 * app the farm's whole ledger, which is the owners' call, the same line
 * can_see_finances() draws in the database.
 */
export async function requireFinance(req: Request, sb: SupabaseClient): Promise<string | null> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const { data } = await sb.auth.getUser(jwt)
  if (!data.user || !mfaSatisfied(data.user, jwt)) return null
  const { data: profile } = await sb.from('users').select('active, is_owner, finance_access').eq('id', data.user.id).single()
  if (!profile?.active || !(profile.is_owner || profile.finance_access)) return null
  return data.user.id
}

type TokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  x_refresh_token_expires_in?: number
  token_type?: string
}

/** Intuit authenticates the app with HTTP Basic (client id : secret). */
export async function qbTokenRequest(params: Record<string, string>, clientId: string, clientSecret: string): Promise<TokenResponse> {
  const res = await fetch(QB_TOKEN, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params).toString(),
  })
  if (!res.ok) throw qbError(`QuickBooks token request failed (${res.status})`, (await res.text()).slice(0, 300), res)
  return res.json()
}

export type QbAccount = { realmId: string; environment: QbEnvironment; token: string }

/** A working access token for the connected company, refreshed when within 5 min of expiry. */
export async function qbAccess(sb: SupabaseClient): Promise<QbAccount> {
  const { data: acct } = await sb.from('integration_accounts').select('*').eq('provider', 'quickbooks').single()
  if (!acct || acct.status !== 'connected' || !acct.access_token || !acct.external_org_id) {
    throw new Error('QuickBooks is not connected')
  }
  const environment: QbEnvironment = acct.meta?.environment === 'sandbox' ? 'sandbox' : 'production'
  const fresh = acct.token_expires_at && new Date(acct.token_expires_at).getTime() - Date.now() > 5 * 60_000
  if (fresh) return { realmId: acct.external_org_id, environment, token: (await decryptToken(acct.access_token))! }

  const cfg = qbConfig()
  if (!cfg) throw new Error('QuickBooks app keys are not set')
  const refresh = await decryptToken(acct.refresh_token)
  if (!refresh) throw new Error('No refresh token — reconnect QuickBooks')
  let tok: TokenResponse
  try {
    tok = await qbTokenRequest({ grant_type: 'refresh_token', refresh_token: refresh }, cfg.clientId, cfg.clientSecret)
  } catch (e) {
    // invalid_grant: the refresh token expired (100 days unused) or was
    // revoked from QuickBooks' side. Only a person can fix that.
    await sb
      .from('integration_accounts')
      .update({ status: 'error', last_error: `Reconnect QuickBooks: ${(e as Error).message.slice(0, 200)}`, updated_at: new Date().toISOString() })
      .eq('provider', 'quickbooks')
    throw e
  }
  await sb
    .from('integration_accounts')
    .update({
      access_token: await encryptToken(tok.access_token),
      refresh_token: await encryptToken(tok.refresh_token ?? refresh),
      token_expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
      meta: {
        ...(acct.meta ?? {}),
        refresh_expires_at: tok.x_refresh_token_expires_in
          ? new Date(Date.now() + tok.x_refresh_token_expires_in * 1000).toISOString()
          : acct.meta?.refresh_expires_at ?? null,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('provider', 'quickbooks')
  return { realmId: acct.external_org_id, environment, token: tok.access_token }
}

/**
 * An Intuit error, carrying its intuit_tid. That header is the id Intuit's
 * support uses to find the call on their side, so it goes into the message —
 * which is logged, kept as the connection's last_error and shown on the
 * Integrations card — and is never lost to "something failed".
 */
function qbError(what: string, detail: string, res: Response): Error {
  const tid = res.headers.get('intuit_tid')
  const e = new Error(`${what}: ${detail}${tid ? ` (intuit_tid ${tid})` : ''}`)
  console.error('[quickbooks]', e.message)
  return e
}

/** GET a company path (e.g. `companyinfo/123`, `query?query=…`). Throws with Intuit's own message. */
export async function qbGet<T = unknown>(a: Pick<QbAccount, 'realmId' | 'environment' | 'token'>, path: string, accept = 'application/json'): Promise<T> {
  const sep = path.includes('?') ? '&' : '?'
  const url = `${qbApiBase(a.environment)}/v3/company/${a.realmId}/${path}${sep}minorversion=${QB_MINOR_VERSION}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${a.token}`, Accept: accept } })
  const text = await res.text()
  // QuickBooks can also answer 200 with a Fault in the body (a validation
  // error inside an otherwise good response), so the body is checked too.
  let fault: { Message?: string; Detail?: string; code?: string } | undefined
  try {
    fault = JSON.parse(text)?.Fault?.Error?.[0]
  } catch {
    /* not JSON (a download link, or an HTML error page) */
  }
  if (!res.ok || fault) {
    const msg = fault ? `${fault.Message}${fault.Detail ? ` — ${fault.Detail}` : ''}${fault.code ? ` [code ${fault.code}]` : ''}` : text.slice(0, 400)
    throw qbError(`QuickBooks ${path.split('?')[0]} failed (${res.status})`, msg, res)
  }
  return (accept === 'application/json' ? JSON.parse(text) : text) as T
}

/** Every row of a query, 1,000 at a time (QuickBooks' page limit). */
export async function qbQueryAll(a: QbAccount, entity: string, where = ''): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let start = 1; start < 200_000; start += 1000) {
    const q = `SELECT * FROM ${entity}${where ? ` WHERE ${where}` : ''} STARTPOSITION ${start} MAXRESULTS 1000`
    const body = await qbGet<{ QueryResponse?: Record<string, unknown> }>(a, `query?query=${encodeURIComponent(q)}`)
    const rows = (body.QueryResponse?.[entity] as Record<string, unknown>[] | undefined) ?? []
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}
