import { createClient } from '@supabase/supabase-js'
import { runAgNewsPull } from '../shared/ag-news-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Sunday evening, so the Monday meeting opens on a week that has already been
// gathered rather than waiting on a fetch while everybody sits there.
export const config = { schedule: '0 2 * * 1' }

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
  try {
    const r = await runAgNewsPull(sb)
    return new Response(JSON.stringify({ ok: true, ...r }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
