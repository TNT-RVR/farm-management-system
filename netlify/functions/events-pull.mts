import { createClient } from '@supabase/supabase-js'
import { runEventsPull } from '../shared/events-pull'
import { hydrateSecrets } from '../shared/secrets.ts'

// Weekly search for conferences and trade shows worth attending. Runs in the
// background via the schedule, so the long Claude+web-search call has time to
// finish. Manual runs go through events-pull-background.mts — the schedule
// export makes THIS function unreachable over HTTP, which is why there are two.
// Needs ANTHROPIC_API_KEY.
// Monday 09:00 UTC — 3am at the ranch through the summer, 2am in winter.
// Netlify schedules in UTC and does not follow Alberta's clock change.
export const config = { schedule: '0 9 * * 1' }

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let apiKey = process.env.ANTHROPIC_API_KEY
let model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  apiKey = process.env.ANTHROPIC_API_KEY
  model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  if (!apiKey)
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 501 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
  try {
    const r = await runEventsPull(sb, apiKey, model)
    return new Response(JSON.stringify({ ok: true, ...r }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 })
  }
}
