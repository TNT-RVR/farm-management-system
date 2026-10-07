import { createClient } from '@supabase/supabase-js'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

// ADMIN-only: remove someone's authenticator, for a lost or replaced phone.
// They sign in with their password alone afterwards and can set up a new one.
// The service role is needed because a person can only remove their own
// factors, and only from a session that already passed the code.
//
// Guards: caller is an active admin who has themselves passed their code if
// they use one (getUserMfa), and the target is named explicitly.

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export default async (req: Request) => {
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return json({ error: 'Server not configured' }, 500)
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Not authenticated' }, 401)

  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: caller } = await getUserMfa(sb, jwt)
  if (!caller.user) return json({ error: 'Invalid session' }, 401)
  const { data: profile } = await sb.from('users').select('role, active').eq('id', caller.user.id).single()
  if (!profile || profile.role !== 'admin' || !profile.active) return json({ error: 'Only admins can reset an authenticator' }, 403)

  const body = (await req.json().catch(() => ({}))) as { id?: string }
  const id = (body.id ?? '').trim()
  if (!id) return json({ error: 'id is required' }, 400)

  const { data: list, error: listErr } = await sb.auth.admin.mfa.listFactors({ userId: id })
  if (listErr) return json({ error: listErr.message }, 400)
  let removed = 0
  for (const f of list?.factors ?? []) {
    const { error } = await sb.auth.admin.mfa.deleteFactor({ id: f.id, userId: id })
    if (error) return json({ error: error.message }, 400)
    removed++
  }
  console.log('[mfa-reset]', JSON.stringify({ by: caller.user.id, user: id, removed }))
  return json({ ok: true, removed })
}
