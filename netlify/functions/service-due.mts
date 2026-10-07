import { createClient } from '@supabase/supabase-js'
import { MANAGER_ROLES } from './_jd.mts'
import { runServiceDue } from '../shared/service-due.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

/**
 * The same sweep as service-due-cron, on demand.
 *
 * For a manager who has just logged a service and wants the task gone now
 * rather than tomorrow morning, and for proving the thing works — a daily
 * schedule is a slow way to find out. No `schedule` export here: one makes a
 * function unreachable over HTTP.
 */
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: au } = bearer ? await getUserMfa(sb, bearer) : { data: { user: null } }
  const { data: prof } = au.user
    ? await sb.from('users').select('id, role, active').eq('id', au.user.id).single()
    : { data: null }
  if (!prof || !prof.active || !MANAGER_ROLES.includes(prof.role)) {
    return new Response('Managers only', { status: 403 })
  }

  try {
    const r = await runServiceDue(sb, prof.id as string)
    return new Response(JSON.stringify({ ok: true, ...r }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500 })
  }
}
