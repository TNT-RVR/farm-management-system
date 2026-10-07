import { createClient } from '@supabase/supabase-js'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

// ADMIN-only user deletion. Deleting the auth user is the real removal — the
// public.users profile row is dropped by its `on delete cascade` FK. RLS alone
// can't do this (auth.users isn't reachable from the client), so it lives here
// behind the service-role key, same shape as invite-user.mts.
//
// Guards: caller must be an active admin, and nobody can delete themselves —
// that's how you end up with an app that has no admin.

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!url || !serviceKey) return json({ error: 'Server not configured' }, 500)

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Not authenticated' }, 401)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: caller, error: callerErr } = await getUserMfa(admin, jwt)
  if (callerErr || !caller.user) return json({ error: 'Invalid session' }, 401)

  const { data: profile } = await admin
    .from('users')
    .select('role, active')
    .eq('id', caller.user.id)
    .single()
  if (!profile || profile.role !== 'admin' || !profile.active) {
    return json({ error: 'Only admins can delete users' }, 403)
  }

  const body = (await req.json().catch(() => ({}))) as { id?: string }
  const id = (body.id ?? '').trim()
  if (!id) return json({ error: 'id is required' }, 400)
  if (id === caller.user.id) return json({ error: 'You cannot delete your own account' }, 400)

  // Read the target first so the response (and the audit trail) names who went.
  const { data: target } = await admin
    .from('users')
    .select('email, full_name, role')
    .eq('id', id)
    .single()
  if (!target) return json({ error: 'No such user' }, 404)

  const { error: delErr } = await admin.auth.admin.deleteUser(id)
  if (delErr) return json({ error: delErr.message }, 400)

  return json({ ok: true, email: target.email, full_name: target.full_name })
}
