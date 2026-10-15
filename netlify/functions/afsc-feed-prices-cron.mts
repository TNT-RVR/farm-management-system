import { createClient } from '@supabase/supabase-js'
import { syncAfscFeedPrices } from '../shared/afsc-feed-prices.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmFeatureOn } from '../../src/lib/farm-context.ts'

// Every Monday: read AFSC's newest Forage and Feed Grain price lists (South
// region, Lethbridge) and price every feed that follows them. AFSC re-uploads
// the lists as the year fills in. One page and two small PDFs — inside the
// thirty seconds a scheduled function gets.
export const config = { schedule: '40 14 * * 1' }

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  // Switched off in Farm setup (or a fresh install that has not turned it on).
  if (!farmFeatureOn('cattle')) return new Response('Cattle is switched off in Farm setup', { status: 200 })
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
  const now = new Date().toISOString()
  try {
    const r = await syncAfscFeedPrices(sb)
    const detail = r.updated.length ? `Updated ${r.updated.join(', ')}` : `No change — ${r.seen}`
    await sb
      .from('integration_health')
      .update({ status: 'ok', detail, last_checked_at: now, last_success_at: now, data_at: now, consecutive_fail: 0, updated_at: now })
      .eq('source_key', 'afsc_feed_prices')
    return new Response(detail, { status: 200 })
  } catch (e) {
    await sb
      .from('integration_health')
      .update({ status: 'error', detail: (e as Error).message.slice(0, 300), last_checked_at: now, updated_at: now })
      .eq('source_key', 'afsc_feed_prices')
    return new Response((e as Error).message, { status: 500 })
  }
}
