import { createClient } from '@supabase/supabase-js'
import { MANAGER_ROLES } from './_jd.mts'
import { runServiceDueUnattended } from '../shared/service-due.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

/**
 * Daily: any service that has come due gets a task.
 *
 * The same check also runs after every Deere equipment sync (fresh hours);
 * this daily run is for the calendar-only plans and machines with no modem.
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

  try {
    const r = await runServiceDueUnattended(sb, MANAGER_ROLES)
    if (!r) return new Response('No active manager to attribute tasks to', { status: 200 })
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
