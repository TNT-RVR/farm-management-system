import { createClient } from '@supabase/supabase-js'
import { MANAGER_ROLES } from './_jd.mts'
import { runServiceDue } from '../shared/service-due.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

/**
 * Daily: any service that has come due gets a task.
 *
 * After the machines have reported their hours for the morning and before the
 * day's list gets looked at. Two queries and a handful of inserts, so it sits
 * comfortably inside a scheduled function's thirty seconds.
 */
export const config = { schedule: '50 12 * * *' } // 06:50 at the ranch

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Tasks need a creator and the job has no login of its own; the irrigation
  // to-dos are attributed the same way.
  const { data: mgr } = await sb
    .from('users')
    .select('id')
    .in('role', MANAGER_ROLES)
    .eq('active', true)
    .limit(1)
    .maybeSingle()
  if (!mgr) return new Response('No active manager to attribute tasks to', { status: 200 })

  try {
    const r = await runServiceDue(sb, mgr.id as string)
    console.log('[service-due]', r.detail)
    return new Response(JSON.stringify({ ok: true, ...r }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    console.error('[service-due]', (e as Error).message)
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500 })
  }
}
