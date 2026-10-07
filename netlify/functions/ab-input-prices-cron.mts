import { createClient } from '@supabase/supabase-js'
import { MANAGER_ROLES } from './_jd.mts'
import { runAbInputPricesPull } from '../shared/ab-input-prices'
import { hydrateSecrets } from '../shared/secrets.ts'

// Alberta Agriculture publish the monthly input price survey a few weeks after
// the month ends, and not on a fixed day — so this looks four times a month
// rather than betting on one date. A month already loaded costs one CKAN call
// and nothing else.
export const config = { schedule: '0 10 3,10,17,24 * *' }

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

  try {
    const r = await runAbInputPricesPull(sb)

    // Only worth saying something when a month actually landed, or when one
    // could not be read — a benchmark going quietly stale is the failure worth
    // hearing about, and "nothing new this week" is not news.
    if (r.loaded.length || r.skipped.length) {
      const { data: managers } = await sb
        .from('users')
        .select('id')
        .in('role', MANAGER_ROLES)
        .eq('active', true)
      const rows = (managers ?? []).map((m) => ({
        user_id: m.id,
        kind: 'ab_input_prices',
        title: r.loaded.length
          ? `Alberta input prices updated: ${r.loaded.length} new month(s)`
          : 'Alberta input prices could not be read',
        body:
          (r.loaded.length ? `Loaded ${r.loaded.join(', ')}. ` : '') +
          (r.skipped.length ? `Could not read: ${r.skipped.join('; ')}.` : ''),
        link: '/fertilizer?tab=Pricing',
      }))
      if (rows.length) await sb.from('notifications').insert(rows)
    }

    return new Response(JSON.stringify({ ok: true, ...r }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 })
  }
}
