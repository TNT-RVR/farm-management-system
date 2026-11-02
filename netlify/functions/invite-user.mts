import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'
import { admin as serviceClient } from '../shared/supabase-admin.ts'

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

  const admin = serviceClient()

  // Identify the caller from their JWT and require an active admin.
  const { data: caller, error: callerErr } = await getUserMfa(admin, jwt)
  if (callerErr || !caller.user) return json({ error: 'Invalid session' }, 401)

  const { data: profile } = await admin
    .from('users')
    .select('role, active')
    .eq('id', caller.user.id)
    .single()
  // The company an invite joins, when the caller runs a partner company.
  let partnerFarm: string | null = null
  // A partner who runs his company invites its people (29 Oct 2026)
  if (profile?.active && profile.role === 'partner') {
    const { data: lead } = await admin.from('users').select('farm_id, partner_admin').eq('id', caller.user.id).single()
    if (lead?.partner_admin && lead.farm_id) partnerFarm = lead.farm_id as string
  }
  if (!profile || !profile.active || (profile.role !== 'admin' && !partnerFarm)) {
    return json({ error: 'Only admins can invite users' }, 403)
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: string
    role?: string
    // An admin's invite into a partner company
    farm_id?: string
    partner_admin?: boolean
  }
  const email = (body.email ?? '').trim().toLowerCase()
  const ROLES = [
    'admin',
    'manager',
    // A partner, his fields only (lib/partner.ts)
    'partner',
  ]
  // A partner company's invite is always to that company, as a partner.
  const role = partnerFarm ? ROLES[ROLES.length - 1] : ROLES.includes(body.role ?? '') ? body.role! : 'user'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'A valid email is required' }, 400)
  }

  // The company the person joins, and whether they run it.
  const joins: Record<string, unknown> = {}
  // An admin invites a partner company's people (Settings → Partners, 30 Oct 2026)
  if (partnerFarm) joins.farm_id = partnerFarm
  else if (role === 'partner' && body.farm_id) {
    const { data: farm } = await admin.from('farms').select('id, is_home').eq('id', body.farm_id).maybeSingle()
    if (!farm || farm.is_home) return json({ error: 'No such partner company' }, 400)
    Object.assign(joins, { farm_id: farm.id, partner_admin: Boolean(body.partner_admin) })
  }

  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    // `invite: true` is read by the handle_new_user trigger to activate the
    // account immediately (invited_at isn't set yet at insert time).
    data: { role, invite: true, ...joins },
    redirectTo: process.env.SITE_URL || 'https://your-farm.example',
  })
  if (inviteErr) return json({ error: inviteErr.message }, 400)

  return json({ ok: true, email, role })
}
