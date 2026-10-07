import { createClient } from '@supabase/supabase-js'
import { runGrantsPull } from '../shared/grants-pull'
import { hydrateSecrets } from '../shared/secrets.ts'

// Weekly auto-pull of open Alberta farm/cattle grants (runs in the background via
// the schedule, so the long Claude+web-search call has time to finish). Manual
// on-demand runs go through grants-pull-background.mts. Needs ANTHROPIC_API_KEY.
export const config = { schedule: '0 14 * * 1' } // Mondays 14:00 UTC

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
  if (!apiKey) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 501 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
  try {
    const r = await runGrantsPull(sb, apiKey, model)
    return new Response(JSON.stringify({ ok: true, ...r }), { status: 200, headers: { 'content-type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 })
  }
}
