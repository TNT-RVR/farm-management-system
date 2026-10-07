import { createClient } from '@supabase/supabase-js'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

// ADMIN-only user invites. Managers deliberately cannot invite — that is the
// whole point of the admin/manager split. Public signup is disabled project-wide;
// this server-side function (service-role key, never shipped to the client) is
// the only path that creates auth users. The invited user's role is stored in
// their metadata and read by the handle_new_user trigger, which also activates
// invited accounts automatically.

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

  // Identify the caller from their JWT and require an active admin.
  const { data: caller, error: callerErr } = await getUserMfa(admin, jwt)
  if (callerErr || !caller.user) return json({ error: 'Invalid session' }, 401)

  const { data: profile } = await admin
    .from('users')
    .select('role, active')
    .eq('id', caller.user.id)
    .single()
  if (!profile || profile.role !== 'admin' || !profile.active) {
    return json({ error: 'Only admins can invite users' }, 403)
  }

  const body = (await req.json().catch(() => ({}))) as { email?: string; role?: string }
  const email = (body.email ?? '').trim().toLowerCase()
  const role =
    body.role === 'admin' ? 'admin' : body.role === 'manager' ? 'manager' : 'user'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'A valid email is required' }, 400)
  }

  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    // `invite: true` is read by the handle_new_user trigger to activate the
    // account immediately (invited_at isn't set yet at insert time).
    data: { role, invite: true },
    redirectTo: process.env.SITE_URL || 'https://your-farm.netlify.app',
  })
  if (inviteErr) return json({ error: inviteErr.message }, 400)

  return json({ ok: true, email, role })
}
