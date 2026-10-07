import { createClient } from '@supabase/supabase-js'
import { runLabelsSync } from '../shared/chemical-labels-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Monthly re-read of the labels for every product this farm sprays.
//
// Cheap by design: for each product it asks PMRA for the label's document id and
// stops there unless that id has changed. PMRA issues a new id when it reissues
// a label, so a full read only happens for labels that actually moved.
export const config = { schedule: '0 9 3 * *' } // 3rd of the month, 09:00 UTC

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let apiKey = process.env.ANTHROPIC_API_KEY
let model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5'

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  apiKey = process.env.ANTHROPIC_API_KEY
  model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5'
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 501 })
  }
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
  try {
    const r = await runLabelsSync(sb, apiKey, model)
    return new Response(JSON.stringify(r), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 })
  }
}
