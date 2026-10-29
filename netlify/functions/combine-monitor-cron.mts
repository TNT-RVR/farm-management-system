import { runCombineMonitorWatch } from '../shared/combine-monitor-watch.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { admin } from '../shared/supabase-admin.ts'

/**
 * Hourly: is any combine's display behind the app's fields? One notice per
 * combine per load (netlify/shared/combine-monitor-watch.ts). A handful of
 * small queries, well inside a scheduled function's thirty seconds.
 */
export const config = { schedule: '23 * * * *' }

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  const sb = admin()
  try {
    const r = await runCombineMonitorWatch(sb)
    if (r.alerted.length) console.log('[combine-monitor] alerted', r.alerted.join(', '))
    return new Response(JSON.stringify({ ok: true, ...r }), { status: 200, headers: { 'content-type': 'application/json' } })
  } catch (e) {
    console.error('[combine-monitor]', (e as Error).message)
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500 })
  }
}
