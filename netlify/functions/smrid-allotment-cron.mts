import { createClient } from '@supabase/supabase-js'
import { syncSmridAllotment } from '../shared/smrid-allotment.ts'
import { MANAGER_ROLES } from './_jd.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmFeatureOn } from '../../src/lib/farm-context.ts'

// Every morning: read SMRID's notices and bring the season's allotment up to
// what the district last announced (15 → 16 → 17 in during 2026). Managers get
// a notification when it moves. One fetch and a few rows — well inside the
// thirty seconds a scheduled function gets.
export const config = { schedule: '0 14 * * *' }

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  // Switched off in Farm setup (or a fresh install that has not turned it on).
  if (!farmFeatureOn('district_allotment')) return new Response('Irrigation district allotment is switched off in Farm setup', { status: 200 })
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
  const now = new Date().toISOString()
  try {
    const r = await syncSmridAllotment(sb, async () => {
      const { data } = await sb.from('users').select('id').in('role', MANAGER_ROLES).eq('active', true)
      return (data ?? []).map((u) => u.id as string)
    })
    const detail = r.changed.length ? `Changed ${r.changed.join(', ')}` : `No change — ${r.seen || 'no allocation in the notices'}`
    await sb
      .from('integration_health')
      .update({ status: 'ok', detail, last_checked_at: now, last_success_at: now, data_at: now, consecutive_fail: 0, updated_at: now })
      .eq('source_key', 'smrid_allotment')
    return new Response(detail, { status: 200 })
  } catch (e) {
    await sb
      .from('integration_health')
      .update({ status: 'error', detail: (e as Error).message.slice(0, 300), last_checked_at: now, updated_at: now })
      .eq('source_key', 'smrid_allotment')
    return new Response((e as Error).message, { status: 500 })
  }
}
