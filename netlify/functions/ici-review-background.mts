import { createClient } from '@supabase/supabase-js'
import { MANAGER_ROLES } from './_jd.mts'
import { advisorModel, alwaysThinks, replyProblem, replyText, type MessagesReply } from '../shared/anthropic-reply.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmProvinceName, farmRetailer, withFarm } from '../../src/lib/farm-context.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

/**
 * Fertilizer → ICI: Claude's review of what ICI put down — whether each
 * field's product and rate was the best choice, and why — written into
 * ici_fert_reviews for the page to pick up.
 *
 * The page builds the request (the field table: ICI's blend, rate, acres and
 * nutrient target, the prescription, the soil-test recommendation, the cost
 * against the same nutrients as straights), so the model weighs numbers it is
 * given rather than inventing them. A background function because the advisor
 * model thinks for a minute or two over twenty fields. Started by a manager
 * from the page (Bearer token).
 */
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let apiKey = process.env.ANTHROPIC_API_KEY
const MODEL_TIMEOUT_MS = 12 * 60_000

/**
 * The prompt, with the farm's retailer by name. Built per request, after
 * hydrateSecrets has set the farm's settings. For ICI it reads word for word
 * as it always has.
 */
const system = (r: string = farmRetailer()) => `You are an independent agronomist reviewing a fertilizer retailer's work for a farm in ${farmProvinceName()}; where the farm has described itself, that comes at the end (soils, irrigation water, crops).
The retailer, ${r === 'ICI' ? 'ICI (your retailer)' : r}, blended and applied fertilizer on each field in the year shown. For every field you get: the crop, ${r}'s blend(s) with rate, acres and the nutrient target printed on its ticket (lb/ac of N, P2O5, K2O, S and micros), the prescription on file (the Rx rates), the soil-test recommendation (lb/ac by nutrient, from the farm's latest soil test for that field), what ${r} charged per acre, and what the same N-P2O5-K2O-S would have cost as straights (urea, MAP, potash, ammonium sulphate) at Alberta average prices before blending and application. Edge Micro Active (a micronutrient/biological additive) and floating (custom application, about $15.50/ac) are shown where used.
For each field say whether ${r}'s choice was the best option, in one or two plain sentences: was each nutrient over or under what the soil test and the prescription call for (and by how much), was a nutrient paid for that the field didn't need (e.g. potash or phosphate on a soil testing high, sulphur where the irrigation water supplies it), was anything the crop needs missing (e.g. S for canola, Zn for beans and corn, N for corn), and did the blend cost much more than straights for the same nutrients. Judge against Alberta guidance for irrigated crops; don't invent soil numbers you are not given, and say "no soil test on file" where there isn't one. Where the retailer's rate is above both the soil test and the prescription, say plainly what the excess cost per acre roughly came to.
Then finish with 3–5 bullet points on the whole year: where the money went that it didn't need to, what to ask ${r} for next year, and whether floating and Edge paid their way.
Format: a line per field starting "- **Field name** (crop): ", then a blank line, then "**The year overall**" and its bullets. Under 900 words. No preamble, no tables.`

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  apiKey = process.env.ANTHROPIC_API_KEY
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  if (!url || !serviceKey || !apiKey) return new Response('Not configured', { status: 500 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: au } = bearer ? await getUserMfa(sb, bearer) : { data: { user: null } }
  if (!au.user) return new Response('Not signed in', { status: 401 })
  const { data: me } = await sb.from('users').select('role, active').eq('id', au.user.id).single()
  if (!me?.active || !MANAGER_ROLES.includes(String(me.role))) return new Response('Managers only', { status: 403 })

  const { year, request } = (await req.json().catch(() => ({}))) as { year?: number; request?: string }
  if (!year || !request) return new Response('year and request required', { status: 400 })
  const model = advisorModel()
  const { data: row, error } = await sb.from('ici_fert_reviews').insert({ crop_year: year, status: 'running', request, model, created_by: au.user.id }).select('id').single()
  if (error || !row) return new Response(error?.message ?? 'insert failed', { status: 500 })
  const finish = (patch: { status: 'done' | 'error'; content?: string; error?: string }) => sb.from('ici_fert_reviews').update({ ...patch, finished_at: new Date().toISOString() }).eq('id', row.id)

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        ...(alwaysThinks(model) ? { output_config: { effort: 'high' } } : {}),
        system: withFarm(system()),
        messages: [{ role: 'user', content: `Year ${year}. Fields (JSON):\n${request}` }],
      }),
    })
    if (!res.ok) {
      await finish({ status: 'error', error: `The model could not answer (${res.status}): ${(await res.text()).slice(0, 300)}` })
      return new Response('model error', { status: 200 })
    }
    const out = (await res.json()) as MessagesReply
    const text = replyText(out, '\n')
    const problem = replyProblem(out, text)
    await finish(problem ? { status: 'error', error: problem } : { status: 'done', content: text })
  } catch (e) {
    const err = e as Error
    await finish({ status: 'error', error: err.name === 'TimeoutError' ? 'The model took too long' : err.message.slice(0, 300) })
  }
  return new Response('ok', { status: 200 })
}
