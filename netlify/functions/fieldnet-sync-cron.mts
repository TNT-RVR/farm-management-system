import { createClient } from '@supabase/supabase-js'
import { runFieldnetSync } from '../shared/fieldnet-sync-core'
import { hydrateSecrets } from '../shared/secrets.ts'

// Auto-refresh: pulls live FieldNET status on a schedule so pivot state stays
// current without anyone clicking "Sync now". Runs server-side with the real
// (write-only) client secret. Scheduled functions run in the background, so the
// per-pivot applied-irrigation calls have time to finish.
// Backed off 18 Sep 2026: the Netlify plan ran out of credits and the site
// served 503 to the whole farm. These three were the bulk of the scheduled
// invocations, and none of them needs to be this eager.
export const config = { schedule: '*/30 * * * *' } // every 30 minutes

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
  // Only run once FieldNET is connected (avoids noisy errors before OAuth).
  const { data: acct } = await sb
    .from('integration_accounts')
    .select('status')
    .eq('provider', 'fieldnet')
    .single()
  if (acct?.status !== 'connected') {
    return new Response(JSON.stringify({ skipped: 'not connected' }), { status: 200 })
  }
  try {
    const r = await runFieldnetSync(sb)
    return new Response(JSON.stringify({ ok: true, ...r }), { status: 200 })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 })
  }
}
