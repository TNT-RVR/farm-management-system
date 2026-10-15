import type { SupabaseClient } from '@supabase/supabase-js'
import { admin, decryptToken, encryptToken, json, makeChallenge, makeVerifier } from './_fieldnet.mts'
import { getUserMfa } from '../shared/auth-mfa.ts'

export { admin, json, makeChallenge, makeVerifier }

// Any.do, one connection per person. Any.do's only programmatic door is its
// MCP server: OAuth 2.1 (dynamic client registration, PKCE S256, refresh
// tokens) in front of JSON-RPC tool calls. Discovery documents:
//   https://mcp.any.do/.well-known/oauth-protected-resource/mcp
//   https://mcp.any.do/.well-known/oauth-authorization-server

export const ANYDO_MCP = 'https://mcp.any.do/mcp'
const ANYDO_AUTHORIZE = 'https://mcp.any.do/authorize'
const ANYDO_TOKEN = 'https://mcp.any.do/token'
const ANYDO_REGISTER = 'https://mcp.any.do/register'
export const ANYDO_SCOPES = 'access_anydo_data update_anydo_data'

// Any.do's registration accepts only localhost return addresses (and the big
// AI apps'), never a web app's (14 Oct 2026: app.example.com refused). So
// the sign-in returns to a localhost address nothing answers; the person
// copies that address into the app, which finishes the link (anydo-finish).
// The path must be exactly /callback: Any.do refuses any other (port is free).
// The code is useless without the PKCE verifier held here.
export const anydoRedirectUri = () => 'http://127.0.0.1:53682/callback'

// The app's own address, for links back to tasks (Netlify's URL is the primary domain).
export const appUrl = () => (process.env.SITE_URL || process.env.URL || 'https://app.example.com').replace(/\/$/, '')

/** The signed-in person behind a request (any active user, MFA honoured), or null. */
export async function requireUser(req: Request, sb: SupabaseClient): Promise<string | null> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const { data } = await getUserMfa(sb, jwt)
  const id = data.user?.id
  if (!id) return null
  const { data: u } = await sb.from('users').select('active').eq('id', id).maybeSingle()
  return u?.active ? id : null
}

/**
 * The app's registered client at Any.do. Registered once (dynamic client
 * registration, public client with PKCE) and kept in operating_settings;
 * registered again if the app's address changes.
 */
export async function anydoClientId(sb: SupabaseClient): Promise<string> {
  const redirect = anydoRedirectUri()
  const { data } = await sb.from('operating_settings').select('value').eq('key', 'anydo_client').maybeSingle()
  const saved = (data?.value ?? null) as { client_id?: string; redirect_uri?: string } | null
  if (saved?.client_id && saved.redirect_uri === redirect) return saved.client_id
  const res = await fetch(ANYDO_REGISTER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'RVR Management',
      redirect_uris: [redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: ANYDO_SCOPES,
    }),
  })
  const body = (await res.json().catch(() => ({}))) as { client_id?: string; error?: string; error_description?: string }
  if (!res.ok || !body.client_id) throw new Error(`Any.do registration failed: ${body.error_description ?? body.error ?? res.status}`)
  await sb.from('operating_settings').upsert({ key: 'anydo_client', value: { client_id: body.client_id, redirect_uri: redirect } }, { onConflict: 'key' })
  return body.client_id
}

export function anydoAuthorizeUrl(clientId: string, state: string, challenge: string): string {
  return `${ANYDO_AUTHORIZE}?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: anydoRedirectUri(),
    scope: ANYDO_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: ANYDO_MCP,
  })}`
}

type TokenReply = { access_token: string; refresh_token?: string; expires_in?: number }

export async function anydoTokenRequest(params: Record<string, string>): Promise<TokenReply> {
  const res = await fetch(ANYDO_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ ...params, resource: ANYDO_MCP }),
  })
  const body = (await res.json().catch(() => ({}))) as TokenReply & { error?: string; error_description?: string }
  if (!res.ok || !body.access_token) throw new Error(`Any.do sign-in failed: ${body.error_description ?? body.error ?? res.status}`)
  return body
}

/** Save a person's keys, encrypted. */
export async function saveTokens(sb: SupabaseClient, userId: string, t: TokenReply, keepRefresh?: string | null) {
  await sb
    .from('anydo_tokens')
    .update({
      access_token: await encryptToken(t.access_token),
      refresh_token: await encryptToken(t.refresh_token ?? keepRefresh ?? null),
      expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
      oauth_state: null,
      oauth_verifier: null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
}

/** A current access token for one person, refreshed when it is near expiry. */
export async function anydoAccessToken(sb: SupabaseClient, userId: string): Promise<string> {
  const { data } = await sb.from('anydo_tokens').select('access_token, refresh_token, expires_at').eq('user_id', userId).maybeSingle()
  if (!data?.access_token) throw new Error('Any.do is not connected')
  const fresh = data.expires_at && new Date(data.expires_at).getTime() - Date.now() > 120_000
  if (fresh) return (await decryptToken(data.access_token))!
  const refresh = await decryptToken(data.refresh_token)
  if (!refresh) throw new Error('Any.do sign-in has expired; connect again')
  const t = await anydoTokenRequest({ grant_type: 'refresh_token', refresh_token: refresh, client_id: await anydoClientId(sb) })
  await saveTokens(sb, userId, t, refresh)
  return t.access_token
}

/**
 * A small MCP client over Streamable HTTP: initialize, then JSON-RPC calls
 * carrying the session id. Replies may come as JSON or as an event stream.
 */
export async function anydoSession(token: string) {
  let session: string | null = null
  let id = 0
  const post = async (body: unknown) => {
    const res = await fetch(ANYDO_MCP, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        ...(session ? { 'Mcp-Session-Id': session } : {}),
      },
      body: JSON.stringify(body),
    })
    session = res.headers.get('mcp-session-id') ?? session
    if (res.status === 202) return null
    const text = await res.text()
    if (!res.ok) throw new Error(`Any.do ${res.status}: ${text.slice(0, 200)}`)
    const payloads = (res.headers.get('content-type') ?? '').includes('text/event-stream')
      ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim())
      : [text]
    for (const p of payloads) {
      try {
        const msg = JSON.parse(p) as { id?: number; result?: unknown; error?: { message?: string } }
        if (msg.error) throw new Error(`Any.do: ${msg.error.message ?? 'error'}`)
        if (msg.result !== undefined) return msg.result
      } catch (e) {
        if ((e as Error).message.startsWith('Any.do')) throw e
      }
    }
    return null
  }
  const call = (method: string, params?: unknown) => post({ jsonrpc: '2.0', id: ++id, method, params })
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'RVR Management', version: '1' } })
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  return {
    call,
    listTools: async () => ((await call('tools/list')) as { tools?: unknown[] } | null)?.tools ?? [],
    tool: (name: string, args: Record<string, unknown>) => call('tools/call', { name, arguments: args }),
  }
}

/**
 * Finish one person's sign-in from the address Any.do sent their browser to
 * (it holds ?code&state). The state must be the one stored on their own row.
 */
export async function finishAnydo(sb: SupabaseClient, userId: string, returned: string): Promise<void> {
  let u: URL
  try {
    u = new URL(returned.trim())
  } catch {
    throw new Error('That is not the address from the browser — copy the whole address bar')
  }
  const err = u.searchParams.get('error')
  if (err) throw new Error(`Any.do said: ${u.searchParams.get('error_description') ?? err}`)
  const code = u.searchParams.get('code')
  const state = u.searchParams.get('state')
  if (!code || !state) throw new Error('That address has no sign-in code in it')
  const { data: row } = await sb.from('anydo_tokens').select('oauth_state, oauth_verifier').eq('user_id', userId).maybeSingle()
  if (!row?.oauth_state || row.oauth_state !== state) throw new Error('That sign-in was not started from your account here — press Connect again')
  const verifier = await decryptToken(row.oauth_verifier)
  if (!verifier) throw new Error('Sign-in expired — press Connect again')
  try {
    const t = await anydoTokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: anydoRedirectUri(),
      client_id: await anydoClientId(sb),
      code_verifier: verifier,
    })
    await saveTokens(sb, userId, t)
    // What Any.do offers this person: the sync is built to it. Best-effort.
    let tools: unknown[] | null = null
    try {
      tools = await (await anydoSession(t.access_token)).listTools()
    } catch {
      tools = null
    }
    await sb.from('anydo_connections').upsert(
      { user_id: userId, status: 'connected', connected_at: new Date().toISOString(), last_error: null, tools, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
  } catch (e) {
    const msg = (e as Error).message.slice(0, 200)
    await sb.from('anydo_connections').upsert({ user_id: userId, status: 'error', last_error: msg, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    throw e
  }
}
