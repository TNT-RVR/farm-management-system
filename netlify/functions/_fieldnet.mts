// Shared FieldNET (Lindsay) v2 API helpers. Docs: https://docs.api.myfieldnet.com/v2
//   authorize  https://v2.api.myfieldnet.com/connect/authorize   (Auth Code + PKCE)
//   token      https://v2.api.myfieldnet.com/connect/token
//   API base   https://v2.api.myfieldnet.com
// Access tokens live 10 min; refresh tokens 365 days (refreshed on use).
// The generic pieces (Supabase admin client, manager check, token encryption,
// json()) are provider-agnostic and reused from _jd.mts to avoid duplication.
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  admin,
  decryptToken,
  encryptToken,
  json,
  requireManager,
  siteUrl,
} from './_jd.mts'

export { admin, decryptToken, encryptToken, json, requireManager }

export const FIELDNET_AUTHORIZE = 'https://v2.api.myfieldnet.com/connect/authorize'
export const FIELDNET_TOKEN = 'https://v2.api.myfieldnet.com/connect/token'
export const FIELDNET_API_BASE = 'https://v2.api.myfieldnet.com'
// Must match the Callback URL registered on FieldNET's manage-applications page
// exactly (they registered it with a slash and it isn't editable). A rewrite in
// netlify.toml routes this path to the fieldnet-callback function.
export const fieldnetRedirectUri = () => `${siteUrl()}/api/fieldnet/callback`
// Scope per FieldNET's own sample apps: the "api" scope grants resource access
// and "offline_access" yields a refresh token. Both are required — omitting
// "api" makes /connect/authorize reject the request as invalid_request.
export const FIELDNET_SCOPES = process.env.FIELDNET_SCOPES ?? 'api offline_access'

export function fieldnetConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.FIELDNET_CLIENT_ID
  const clientSecret = process.env.FIELDNET_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

// ---- PKCE ------------------------------------------------------------------
function b64url(buf: ArrayBuffer | Uint8Array): string {
  return Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString('base64url')
}
/** A high-entropy code verifier (43 chars, RFC 7636). */
export function makeVerifier(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)))
}
/** S256 challenge for a verifier. */
export async function makeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return b64url(digest)
}

// ---- Token exchange --------------------------------------------------------
type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  token_type?: string
}

/**
 * Exchange an auth code (+ PKCE verifier) or a refresh token for tokens.
 * FieldNET's sample apps authenticate the client via body params
 * (client_secret_post: include_client_id=True + client_secret), not HTTP Basic.
 */
export async function fieldnetTokenRequest(
  params: Record<string, string>,
  clientId: string,
  clientSecret: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    ...params,
    client_id: clientId,
    client_secret: clientSecret,
  })
  const res = await fetch(FIELDNET_TOKEN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`FieldNET token request failed (${res.status}): ${await res.text()}`)
  return res.json()
}

/** A valid access token, refreshing when it expires within 3 min (life is 10). */
export async function fieldnetAccessToken(sb: SupabaseClient): Promise<string> {
  const { data: acct } = await sb
    .from('integration_accounts')
    .select('*')
    .eq('provider', 'fieldnet')
    .single()
  if (!acct || acct.status !== 'connected' || !acct.access_token) {
    throw new Error('FieldNET is not connected')
  }
  const expiresSoon =
    !acct.token_expires_at || new Date(acct.token_expires_at).getTime() - Date.now() < 3 * 60 * 1000
  if (!expiresSoon) return (await decryptToken(acct.access_token))!

  const cfg = fieldnetConfig()
  if (!cfg) throw new Error('FieldNET app not configured')
  const refresh = await decryptToken(acct.refresh_token)
  if (!refresh) throw new Error('No refresh token — reconnect FieldNET')
  const tok = await fieldnetTokenRequest(
    { grant_type: 'refresh_token', refresh_token: refresh, scope: FIELDNET_SCOPES },
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
    .eq('provider', 'fieldnet')
  return tok.access_token
}

// ---- API GET ---------------------------------------------------------------
/** GET a FieldNET path (Bearer). Throws on non-2xx with the body for debugging. */
export async function fieldnetGet<T = unknown>(token: string, path: string): Promise<T> {
  const url = path.startsWith('http') ? path : `${FIELDNET_API_BASE}${path}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`FieldNET GET ${path} failed (${res.status}): ${await res.text()}`)
  return res.json() as Promise<T>
}

/**
 * PATCH a FieldNET path. Unlike fieldnetGet this never throws on a non-2xx —
 * the caller wants to inspect validation errors, not just fail. Returns the
 * status alongside the parsed body (or raw text when it isn't JSON).
 */
export async function fieldnetPatch(
  token: string,
  path: string,
  payload: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${FIELDNET_API_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  try {
    return { status: res.status, body: JSON.parse(text) }
  } catch {
    return { status: res.status, body: text.slice(0, 500) }
  }
}

/**
 * Page through a list endpoint that takes ?page & ?page-size. Works for both
 * GeoJSON FeatureCollection responses (systems) and array/enveloped list
 * responses (controllers) — the shape is normalised by `extract`.
 */
export async function fieldnetList<T>(
  token: string,
  basePath: string,
  extract: (body: unknown) => T[],
  pageSize = 100,
): Promise<T[]> {
  const out: T[] = []
  const sep = basePath.includes('?') ? '&' : '?'
  for (let page = 1; page <= 50; page++) {
    const body = await fieldnetGet(token, `${basePath}${sep}page=${page}&page-size=${pageSize}`)
    const items = extract(body)
    out.push(...items)
    if (items.length < pageSize) break
  }
  return out
}

/** Best-effort list extraction across the shapes FieldNET returns. */
export function listFrom(body: unknown): unknown[] {
  if (Array.isArray(body)) return body
  const b = body as Record<string, unknown>
  for (const k of ['features', 'items', 'data', 'value', 'results']) {
    if (Array.isArray(b?.[k])) return b[k] as unknown[]
  }
  return []
}
