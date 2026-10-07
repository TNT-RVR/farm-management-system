import { createClient } from '@supabase/supabase-js'
import { replyProblem, replyText, type MessagesReply } from '../shared/anthropic-reply.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmProvinceName, withFarm } from '../../src/lib/farm-context.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

/**
 * Fertilizer → Blends: Claude's read of the cheapest mixes.
 *
 * The numbers are worked out in the page (least-cost, every product
 * combination), so the model never does arithmetic that matters. It is given
 * the field, the targets and the ranked options, and asked which it would
 * pick and why — slow-release N on irrigated ground, sulphate S for canola,
 * seed-row safety, blends that will separate in the cart.
 */
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let apiKey = process.env.ANTHROPIC_API_KEY
let model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'

export const config = { path: '/api/blend-advice' }

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })

// Built per request: the province comes from Farm setup, loaded after this module.
const SYSTEM = () => `You are an agronomist advising a farm in ${farmProvinceName()}; where the farm has described itself, that comes at the end.
You are shown a field's nutrient targets and fertilizer blend options already costed by a least-cost calculator. Every amount is lb/ac and keyed by its nutrient: N, P2O5, K2O, S, Zn. Each option also carries what it is short of or over each target and, where the crop has one, how far its P2O5 is over the seed-row limit if all of it went with the seed. All of these are worked out already and correct: use them as given, and do not recalculate costs, rates or nutrient amounts.
Recommend one option, or say how to adjust. Weigh: cost per acre; the short-of and over figures; slow-release N (ESN) where N loss is likely (irrigated, early seeding, sandy soils); sulphate-S for canola (elemental S is not available in-season); seed-row safety — the P2O5 limit is the seed_row_p2o5_limit given (Alberta and Saskatchewan tables): where an option is over it, say that much P2O5 has to be banded away from the seed; if no limit is given, do not name a seed-row number; no urea or potash with the seed at meaningful rates; calcareous soils tie up P, so banding helps; blends whose product densities differ by more than about 8 lb/ft³ may separate; zinc for beans and corn on low-Zn calcareous soils.
Numbers: the page already shows the targets, so do not restate them. Whenever you do give an amount, put the nutrient's name beside it ("P2O5 30 lb/ac") and copy the figure exactly; never write nutrient amounts as a dash-separated string like 120-30-0-15. Product grades (11-52-0) are fine.
Only refer to what you are given: if no soil test, crop or field is included, do not mention one. Write 4–7 short bullet points starting with "- ", in plain language a farmer reads on a phone. Lead with the pick. Bold at most a few words with **. No preamble, no headings, no tables.`

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
  if (text.length > 20_000) return json({ error: 'Too much to send' }, 413)

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
      messages: [{ role: 'user', content: `Field and options (JSON):\n${text}` }],
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
