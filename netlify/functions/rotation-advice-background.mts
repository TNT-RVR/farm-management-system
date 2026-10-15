import { createClient } from '@supabase/supabase-js'
import { advisorModel, alwaysThinks, replyProblem, replyText, type MessagesReply } from '../shared/anthropic-reply.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmProvinceName, withFarm } from '../../src/lib/farm-context.ts'

/**
 * Rotation → recommendations: Claude's comparison of the three plans, written
 * into rotation_advice for the page to pick up.
 *
 * The plans are built by the rotation engine in the page (hard rules, then
 * scores for agronomy, profit and soil, inside the acre limits), so the model
 * never decides what is allowed. It compares the three and says which to take.
 *
 * A background function because the advisor model (Opus 5.5) thinks for about
 * a minute and a half on the full farm — on real 2027 plans it was the only
 * model with no factual slips about what the plans contain. Woken by
 * /api/rotation-advice with the worker key; never by a browser.
 */
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let apiKey = process.env.ANTHROPIC_API_KEY
let workerKey = process.env.JOB_WORKER_KEY

/** Well inside the fifteen minutes a background function gets. */
const MODEL_TIMEOUT_MS = 12 * 60_000

// Built per request: the province comes from Farm setup, loaded after this module.
const SYSTEM = () => `You are an agronomist advising a farm in ${farmProvinceName()}; where the farm has described itself, that comes at the end (soils, water, crops, livestock).
You are shown three crop plans for one year built by a rules engine: "Best rotation", "Most profitable" and "Best for the soil". Each has already passed the hard rules (return intervals, blocked crop-after-crop pairs, herbicide carryover from the labels, irrigation, salinity) and respects the farm's maximum acres per crop. Do not re-check those rules or invent new numbers.
Compare the three: where they agree, where they differ and what each difference costs or gains (margin, soil carbon and wind-erosion risk on the sands, disease pressure, workload at harvest for late crops like potatoes, corn and beans). Recommend which plan to take, or a blend of them field by field, and say what to watch.
Research the engine is built on (use it, don't cite beyond it): potatoes and dry beans need 1-in-4 or longer; canola 1-in-3, 1-in-4 where blackleg/clubroot; never a small grain right after corn (FHB); a cereal between row crops; on the sands a low-residue crop (potato, bean, carrot) needs a fall rye cover and a cereal after it; the AAFC Vauxhall study found the most profitable potato rotation lost soil carbon while the 5-year conservation rotation built it — farm manure narrows that gap.
The "season" block is the year ahead as the app knows it: the irrigation water each source has against what each plan needs (an irrigation-district what-if allotment may be set), reservoir storage against the same date last year, headwater snowpack, SMRID's latest notices, corn heat units (median and a cool year) with the CanSIPS/SEAS5 summer outlook, and each crop's margin built from the farm's own yield history, contracts/target/market prices and input budgets (or the Alberta budget where those are missing). Each field also carries its margin basis, water source, expected heat units and what the scouts found there. Use these: say plainly when a plan leans on water that may not come, on a price from an old or thin source, or on corn/beans in a cool-leaning year, and when a scouted disease or pest argues for a different crop. A seasonal outlook months ahead is weak evidence — treat it as a reason to keep a fallback, not to change the plan.
It is read on a phone in a truck, so length matters as much as content. Write 5–8 bullet points starting with "- ", each one to three plain sentences, with no sub-bullets, and keep the whole answer under 350 words — choose the points that change a decision and leave the rest out. Lead with the recommendation. Bold at most a few words with **. No preamble, no headings, no tables.`

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  apiKey = process.env.ANTHROPIC_API_KEY
  workerKey = process.env.JOB_WORKER_KEY
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  if (!workerKey || req.headers.get('x-worker-key') !== workerKey) return new Response('Not authorised', { status: 403 })
  if (!url || !serviceKey || !apiKey) return new Response('Not configured', { status: 500 })

  const { id } = (await req.json().catch(() => ({}))) as { id?: string }
  if (!id) return new Response('id required', { status: 400 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: row } = await sb.from('rotation_advice').select('id, status, request').eq('id', id).single()
  // Only a waiting request: a retried wake-up must not write it twice.
  if (!row || row.status !== 'pending') return new Response('nothing to do', { status: 200 })

  const model = advisorModel()
  const finish = async (patch: { status: 'done' | 'error'; advice?: string; error?: string }) => {
    const { error } = await sb
      .from('rotation_advice')
      .update({ ...patch, model, finished_at: new Date().toISOString() })
      .eq('id', id)
    if (error) console.error('[rotation-advice] write failed:', error.message)
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        // Room for the thinking before the answer; effort is the only dial on
        // a model that always thinks.
        max_tokens: 16000,
        ...(alwaysThinks(model) ? { output_config: { effort: 'high' } } : {}),
        system: withFarm(SYSTEM()),
        messages: [{ role: 'user', content: `Field and options (JSON):\n${row.request}` }],
      }),
    })
    if (!res.ok) {
      await finish({ status: 'error', error: `The model could not answer (${res.status}): ${(await res.text()).slice(0, 300)}` })
      return new Response('model error', { status: 200 })
    }
    const out = (await res.json()) as MessagesReply
    const advice = replyText(out, '\n')
    const problem = replyProblem(out, advice)
    await finish(problem ? { status: 'error', error: problem } : { status: 'done', advice })
  } catch (e) {
    const err = e as Error
    await finish({
      status: 'error',
      error: err.name === 'TimeoutError' ? `The model took longer than ${MODEL_TIMEOUT_MS / 60_000} minutes` : err.message.slice(0, 300),
    })
  }
  return new Response('ok', { status: 200 })
}
