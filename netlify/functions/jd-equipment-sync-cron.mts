import { createClient } from '@supabase/supabase-js'
import { runJdEquipmentSync } from '../shared/jd-equipment-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Every two hours. Engine hours are what maintenance intervals get measured
// against, so they should not be a day stale — but this makes one API call per
// machine and there are 84 of them, so it does not belong on a 30-minute cycle.
export const config = { schedule: '5 */2 * * *' }

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
  try {
    const r = await runJdEquipmentSync(sb)
    return new Response(JSON.stringify(r), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 })
  }
}
