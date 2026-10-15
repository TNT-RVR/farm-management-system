import { createClient } from '@supabase/supabase-js'
import { replyProblem, replyText, type MessagesReply } from '../shared/anthropic-reply.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmProvinceName, withFarm } from '../../src/lib/farm-context.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

/**
 * Crops → Compare crops: Claude's pick between the two crops a person chose
 * and the rotation engine's own pick for the field.
 *
 * Every number is worked out in the page (src/lib/crop-compare.ts) and every
 * warning by the rotation engine, so the model weighs them and never does
 * arithmetic that matters.
 */
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let apiKey = process.env.ANTHROPIC_API_KEY
let model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'

export const config = { path: '/api/crop-compare-advice' }

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })

// Built per request: the province comes from Farm setup, loaded after this module.
const SYSTEM = () => `You are an agronomist and farm business adviser for a farm in ${farmProvinceName()}; where the farm has described itself, that comes at the end.
You are shown one field and the crops being weighed for it: two a person chose (A and B) and the rotation engine's pick (C), each already costed. All figures are per acre unless named otherwise and are correct: use them as given and do not recalculate.
over_inputs_per_ac is what the crop makes over its own inputs and custom work, before the farm's fixed expenses (land, machinery, labour, overhead). Fixed expenses are the same whatever is planted, so they do not decide between crops; covers_fixed_at_yield and fixed_per_acre only say whether a crop pulls its weight. blocked warnings mean the crop should not go on this field; cautions are risks to weigh; positives are rotation benefits. engine_ranking is the engine's order for this field (money with rotation effects, plus agronomy), for context.
Recommend one crop for this field and year. Weigh: over_inputs_per_ac; how far the yield could fall before it stops paying its inputs (pays_inputs_at_yield against the expected yield); warnings; what the field grew before; irrigation need on a dryland or water-short field; price and market risk for crops sold into small or contracted markets. If the yield or price came from a default rather than the farm's own records, say the pick leans on that figure.
Only refer to what you are given. Write 4–7 short bullet points starting with "- ", in plain language a farmer reads on a phone. Lead with the pick. Bold at most a few words with **. No preamble, no headings, no tables.`

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  apiKey = process.env.ANTHROPIC_API_KEY
  model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!url || !serviceKey) return json({ error: 'Not configured' }, 500)
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set' }, 501)

  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: au } = bearer ? await getUserMfa(sb, bearer) : { data: { user: null } }
  const { data: prof } = au.user ? await sb.from('users').select('active').eq('id', au.user.id).single() : { data: null }
  if (!prof?.active) return json({ error: 'Not authorised' }, 401)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Send JSON' }, 400)
  }
  const text = JSON.stringify(body)
  if (text.length > 30_000) return json({ error: 'Too much to send' }, 413)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      // No extended thinking: it can spend the whole budget before the answer
      // starts, and it adds time the person spends waiting on this screen.
      thinking: { type: 'disabled' },
      system: withFarm(SYSTEM()),
      messages: [{ role: 'user', content: `Field and crops (JSON):\n${text}` }],
    }),
  })
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    return json({ error: `The model could not answer (${res.status}): ${detail}` }, 502)
  }
  const out = (await res.json()) as MessagesReply
  const advice = replyText(out, '\n')
  const problem = replyProblem(out, advice)
  if (problem) return json({ error: problem }, 502)
  return json({ advice })
}
