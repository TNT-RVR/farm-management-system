import { createClient } from '@supabase/supabase-js'
import { syncSmridRates } from '../shared/smrid-rates.ts'
import { MANAGER_ROLES } from './_jd.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmFeatureOn } from '../../src/lib/farm-context.ts'

// Every Monday: read the year's irrigation rate per acre from SMRID's newest
// Policy Book and keep it beside the allotment ($38/acre in 2026, set each
// January). Managers get a notification when it changes. One small search and
// one PDF — inside the thirty seconds a scheduled function gets.
export const config = { schedule: '20 14 * * 1' }

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
    const r = await syncSmridRates(sb, async () => {
      const { data } = await sb.from('users').select('id').in('role', MANAGER_ROLES).eq('active', true)
      return (data ?? []).map((u) => u.id as string)
    })
    const detail = r.changed ? `Changed ${r.changed}` : `No change — ${r.seen}`
    await sb
      .from('integration_health')
      .update({ status: 'ok', detail, last_checked_at: now, last_success_at: now, data_at: now, consecutive_fail: 0, updated_at: now })
      .eq('source_key', 'smrid_rates')
    return new Response(detail, { status: 200 })
  } catch (e) {
    await sb
      .from('integration_health')
      .update({ status: 'error', detail: (e as Error).message.slice(0, 300), last_checked_at: now, updated_at: now })
      .eq('source_key', 'smrid_rates')
    return new Response((e as Error).message, { status: 500 })
  }
}
