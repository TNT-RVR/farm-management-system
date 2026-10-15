import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { SETUP_KEYS, SETUP_KEY_NAMES, type KeyStatus } from '../../src/lib/setup-keys.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

/**
 * Farm setup's keys: which are set, and saving or clearing one. Admins only.
 *
 *   GET                              → { keys: KeyStatus[] }
 *   POST { env, value }              → save (empty value clears it)
 *   POST { env, generate: true }     → make up a random one and save it
 *
 * A value is never sent back — not on GET, not after saving. The screen only
 * ever learns whether a key is set and whether it came from Netlify or the app.
 * The one exception is a plain note marked `shown` (never a secret), such as
 * which email an account was opened with.
 * Keys live in app_secrets, which no browser can read (RLS with no policies)
 * and which is deliberately not audited, so a key never lands in audit_log.
 *
 * This function does not call hydrateSecrets: what it reports as "Netlify"
 * must be Netlify's environment alone, not keys this app put there.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export default async (req: Request) => {
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return json({ error: 'Server is missing its database settings' }, 500)
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

  // The caller, from their sign-in, must be an active admin.
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: caller } = await getUserMfa(sb, jwt)
  if (!caller?.user) return json({ error: 'Not signed in' }, 401)
  const { data: me } = await sb.from('users').select('role, active').eq('id', caller.user.id).single()
  if (!me || me.role !== 'admin' || !me.active) return json({ error: 'Only admins can change farm keys' }, 403)

  if (req.method === 'GET') {
    const { data: rows, error } = await sb
      .from('app_secrets')
      .select('key, value, updated_at')
      .in('key', [...SETUP_KEY_NAMES])
    if (error) return json({ error: error.message }, 500)
    const saved = new Map((rows ?? []).map((r) => [r.key as string, r as { value: string; updated_at: string }]))
    const keys: KeyStatus[] = SETUP_KEYS.map((k) => ({
      env: k.env,
      source: process.env[k.env] ? 'netlify' : saved.has(k.env) ? 'app' : null,
      updated_at: saved.get(k.env)?.updated_at ?? null,
      ...(k.shown && !k.secret ? { value: process.env[k.env] ?? saved.get(k.env)?.value ?? null } : {}),
    }))
    return json({ keys })
  }

  if (req.method !== 'POST') return json({ error: 'GET or POST' }, 405)
  const body = (await req.json().catch(() => ({}))) as { env?: string; value?: string | null; generate?: boolean }
  const def = SETUP_KEYS.find((k) => k.env === body.env)
  if (!def) return json({ error: 'Not a key this screen manages' }, 400)

  const value = body.generate && def.generate ? randomBytes(24).toString('base64url') : (body.value ?? '').trim()
  if (!value) {
    const { error } = await sb.from('app_secrets').delete().eq('key', def.env)
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true, cleared: true })
  }
  const { error } = await sb
    .from('app_secrets')
    .upsert({ key: def.env, value, note: `Farm setup: ${def.group} — ${def.label}`, updated_at: new Date().toISOString() })
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
}
