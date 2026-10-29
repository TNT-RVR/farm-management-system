import { replyProblem, replyText, type MessagesReply } from '../shared/anthropic-reply.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'
import { admin } from '../shared/supabase-admin.ts'
import { alwaysThinks, callClaude, SONNET_5, SONNET_5_5 } from '../shared/anthropic.ts'
import { isStaff } from '../shared/staff.ts'

/**
 * Read the weight off the photo of the scale that the weigh-in already takes
 * (Sam, 27 Oct 2026: "when they take a picture of the weigh scale reading it
 * auto fills in the amount").
 *
 * The photo is the record either way — it is uploaded and kept whatever this
 * says — so this only saves the typing, and the number lands in the box where
 * the driver can see it against the display in front of him before saving.
 *
 * The readouts are kilograms on a digital indicator, and a phone photo of a
 * seven-segment display behind a dusty, reflecting window is the hardest thing
 * there is to read confidently: a glare across the middle bar turns 8 into 0,
 * 6 into 5. Tested against the photos already saved with weights somebody
 * typed, one read got about half of them exactly right and was sure of itself
 * when it was wrong — which is the dangerous kind of wrong, because the number
 * becomes a grain record.
 *
 * So the photo is read TWICE, by two different models, and the weight is only
 * offered to fill the box when the two agree. Where they differ the form says
 * the photo could not be read and the person types it, exactly as before.
 */
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let apiKey = process.env.ANTHROPIC_API_KEY
let model = process.env.ANTHROPIC_MODEL ?? SONNET_5

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })

const MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

const PROMPT = `This is a photo of a truck scale's readout, taken at a farm to record how much a grain truck weighs. It is usually a seven-segment digital display on an indicator box, sometimes a printed scale ticket, a computer screen, or a dial.

Read the WEIGHT the scale is showing.

Work through it digit by digit, left to right, and list what you read in "digits" (e.g. "6 4 8 6 0"). "weight" must be exactly those digits, in order, with nothing added.

What makes these photos hard, and what to do:
- The window reflects. A reflection across the middle of a digit makes an 8 look like a 0, and a 6 look like a 5 or a 0. Before you settle on a digit, look at which segments are LIT, not at the shape you expect.
- Dust and glare hide segments. If you cannot see every segment of a digit clearly, return null for "weight" and name the digit in "note". A missing read costs somebody ten seconds of typing; a wrong read goes into the grain records.
- Scales usually weigh to the nearest 10 kg, so the last digit is often 0 — but never assume it: read it.
- Ignore anything that is not the weight: the handwritten capacity on the frame (e.g. "66000 kg x 10 kg"), the maker's name, a clock, a date, a truck or ticket number, a battery or signal icon.
- Lit words beside the digits (kg, lb, NET, GROSS, TARE, ZERO, MOTION) tell you the unit and what is shown. Put which one is lit in "shows". A NET lamp on a farm indicator usually just means it is weighing against a zeroed platform; read the number either way.
- A printed ticket often lists GROSS, TARE and NET. Read the GROSS (the biggest) into "weight" and put the others in "note".
- If two different weights are on the screen and you cannot tell which is the live one, return null and say so.

Units: these scales are in kilograms. Only say "lb" if the display says lb/LB/pounds, or the number is far too big for kilograms (a loaded semi is roughly 40,000–80,000 kg, empty roughly 13,000–25,000 kg).

Return ONLY JSON, no prose:
{"digits": string, "weight": number|null, "unit": "kg"|"lb"|"t"|"unknown",
 "shows": "live"|"gross"|"tare"|"net"|"unknown",
 "kind": "display"|"ticket"|"screen"|"dial"|"other",
 "confidence": "high"|"medium"|"low", "note": string}
"note" is for what somebody at the scale would need to know — a digit you could not read, a second weight on the screen, a ticket's other figures. Nothing to say means "". Never guess a digit.`

type Read = {
  weight: number | null
  unit: 'kg' | 'lb' | 't' | 'unknown'
  kg: number | null
  shows: string
  kind: string
  confidence: string
  note: string
}

/** Kilograms is what every load is stored in. */
const toKg = (weight: number | null, unit: string) =>
  weight == null ? null : unit === 'lb' ? Math.round(weight * 0.45359237) : unit === 't' ? Math.round(weight * 1000) : Math.round(weight)

/**
 * How to tell this model not to think. Somebody is standing at the scale
 * waiting, and each model wants it put differently: Sonnet 5 takes
 * `disabled`, Sonnet 5.5 refuses that and thinks only between tools (there
 * are none here), and a model that always thinks gets the least effort it
 * will take.
 */
const dontThink = (model: string) =>
  alwaysThinks(model)
    ? { output_config: { effort: 'low' } }
    : model.startsWith(SONNET_5_5)
      ? { thinking: { type: 'between_tools' } }
      : { thinking: { type: 'disabled' } }

async function readOnce(model: string, mediaType: string, data: string, apiKey: string): Promise<Read | { error: string }> {
  const res = await callClaude(
    {
      model,
      maxTokens: alwaysThinks(model) ? 4000 : 600,
      ...dontThink(model),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    },
    { apiKey },
  )
  if (!res.ok) return { error: `Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}` }
  const reply = (await res.json()) as MessagesReply
  const text = replyText(reply)
  const problem = replyProblem(reply, text)
  if (problem) return { error: problem }
  try {
    const p = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, unknown>
    const weight = typeof p.weight === 'number' && Number.isFinite(p.weight) && p.weight > 0 ? p.weight : null
    const unit = p.unit === 'kg' || p.unit === 'lb' || p.unit === 't' ? p.unit : 'unknown'
    // The digits it says it read must be the number it returned, or it has
    // written down something other than what it looked at.
    const digits = typeof p.digits === 'string' ? p.digits.replace(/[^0-9]/g, '') : ''
    const kept = weight != null && digits && digits !== String(Math.round(weight)) ? null : weight
    return {
      weight: kept,
      unit,
      kg: toKg(kept, unit),
      shows: p.shows === 'gross' || p.shows === 'tare' || p.shows === 'net' || p.shows === 'live' ? p.shows : 'unknown',
      kind: typeof p.kind === 'string' ? p.kind : 'other',
      confidence: p.confidence === 'high' || p.confidence === 'medium' ? (p.confidence as string) : 'low',
      note: typeof p.note === 'string' ? p.note : '',
    }
  } catch {
    return { error: 'Could not read a weight off that photo' }
  }
}

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  apiKey = process.env.ANTHROPIC_API_KEY
  model = process.env.ANTHROPIC_MODEL ?? SONNET_5
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!url || !serviceKey) return json({ error: 'Not configured' }, 500)
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set' }, 501)

  const sb = admin()
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: au } = bearer ? await getUserMfa(sb, bearer) : { data: { user: null } }
  const { data: prof } = au.user
    ? await sb.from('users').select('active, role').eq('id', au.user.id).single()
    : { data: null }
  if (!isStaff(prof)) return json({ error: 'Not authorised' }, 401)

  const mediaType = (req.headers.get('x-media-type') ?? req.headers.get('content-type') ?? '').split(';')[0].trim()
  if (!MEDIA.has(mediaType)) return json({ error: `Send a photo (got ${mediaType || 'nothing'})` }, 415)
  const buf = new Uint8Array(await req.arrayBuffer())
  if (!buf.length) return json({ error: 'No photo' }, 400)
  if (buf.length > 8 * 1024 * 1024) return json({ error: 'Photo is over 8 MB' }, 413)

  const data = Buffer.from(buf).toString('base64')
  // Two reads, by two models. They agree on a display that can be read, and
  // part company on one that cannot — which is the only honest way to tell the
  // two apart without a person checking every photo. Both are models that can
  // be told not to think: Opus 5.5 always does, and the wait at the scale is
  // the whole point of this.
  const second = process.env.ANTHROPIC_SECOND_MODEL ?? SONNET_5_5
  const [a, b] = await Promise.all([
    readOnce(model, mediaType, data, apiKey),
    readOnce(second === model ? SONNET_5 : second, mediaType, data, apiKey),
  ])
  if ('error' in a && 'error' in b) return json({ error: a.error }, 502)
  const reads = [a, b].filter((r): r is Read => !('error' in r))
  const first = reads[0]
  const agreed = reads.length === 2 && reads[0].kg != null && reads[0].kg === reads[1].kg
  // One read on its own is never enough to fill a weight in by itself: it is
  // returned so the form can say what it saw, with `agreed` false.
  return json({
    // Why a read did not come back, when one did not: a model that is not
    // reachable would otherwise look exactly like a photo nobody can read.
    problems: [a, b].flatMap((r) => ('error' in r ? [r.error.slice(0, 120)] : [])),
    weight: first.weight,
    unit: first.unit,
    kg: first.kg,
    agreed,
    reads: reads.map((r) => r.kg),
    shows: first.shows,
    kind: first.kind,
    confidence: agreed ? first.confidence : 'low',
    note: agreed
      ? first.note
      : reads.length === 2 && reads[0].kg != null && reads[1].kg != null
        ? `The photo was read twice and came out differently each time (${reads[0].kg} and ${reads[1].kg} kg), so it is not clear enough to go on.`
        : (reads.find((r) => r.note)?.note ?? ''),
  })
}
