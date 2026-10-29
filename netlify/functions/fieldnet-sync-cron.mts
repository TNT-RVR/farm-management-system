import { runFieldnetSync } from '../shared/fieldnet-sync-core'
import { hydrateSecrets } from '../shared/secrets.ts'
import { adminOrNull } from '../shared/supabase-admin.ts'
import { farmClock } from '../shared/dates.ts'

// Auto-refresh: pulls live FieldNET status on a schedule so pivot state stays
// current without anyone clicking "Sync now". Runs server-side with the real
// (write-only) client secret.
// Backed off 18 Sep 2026: the Netlify plan ran out of credits and the site
// served 503 to the whole farm. These three were the bulk of the scheduled
// invocations, and none of them needs to be this eager.
// The applied-irrigation sectors (three calls per pivot) are refreshed by the
// hourly fieldnet-applied job, not here. November to March the pivots are
// parked, so the status is read every three hours instead of every half hour.
export const config = { schedule: '*/30 * * * *' } // every 30 minutes

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const { hour, minute, month } = farmClock()
  if ((month >= 11 || month <= 3) && (hour % 3 !== 0 || minute >= 30)) {
    return new Response(JSON.stringify({ skipped: 'off-season: every 3 hours' }), { status: 200 })
  }
  const sb = adminOrNull()
  if (!sb) return new Response('Not configured', { status: 500 })
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
    const r = await runFieldnetSync(sb, { applied: false })
    return new Response(JSON.stringify({ ok: true, ...r }), { status: 200 })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 })
  }
}
