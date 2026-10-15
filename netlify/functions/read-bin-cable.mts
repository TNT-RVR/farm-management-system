import { createClient } from '@supabase/supabase-js'
import { replyProblem, replyText, type MessagesReply } from '../shared/anthropic-reply.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

/**
 * Read a bin's sensor cable off a screenshot of the Bin-Sense app.
 *
 * Bin-Sense cannot be pulled automatically, and scraping its web app is off
 * the table, so the reading comes from the screen the person is already
 * looking at: a screenshot pasted or picked on the phone. The model reads each
 * sensor's temperature and percentage, top to bottom; the person sees every
 * number in the form before anything is saved. The image is not stored.
 *
 * The percentage on that screen is usually grain moisture that Bin-Sense has
 * already worked out for the commodity set on the bin, not relative humidity.
 * The model says which it thinks it is and why; the form lets the person say
 * otherwise, because the two are converted very differently.
 */
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let apiKey = process.env.ANTHROPIC_API_KEY
let model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })

const MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

const PROMPT = `This is a screenshot of a grain bin monitoring app (usually Bin-Sense) showing one bin and its sensor cable(s).

Read every sensor on the cable from the TOP of the bin to the BOTTOM. Each sensor shows a temperature (°C) and usually a percentage; a sensor may show "No Data" for the percentage.
If there is more than one cable, read the first (left-most) cable only and say so in "note".

Also read, if shown: the bin name, the commodity/crop, the ambient or headspace temperature shown apart from the cable, and the bushels.

Decide what the percentage is:
- "rh" if it is labelled RH, %RH, humidity, or the values are typical of air humidity (usually 20–95%).
- "moisture" if it is grain moisture / EMC (usually 3–25%, often shown next to a commodity).
- "unknown" if you cannot tell.

Return ONLY JSON, no prose:
{"bin_name": string|null, "crop": string|null, "ambient_temp_c": number|null, "bushels": number|null,
 "percent_kind": "rh"|"moisture"|"unknown",
 "levels": [{"temp_c": number|null, "pct": number|null, "no_data": boolean}],
 "confidence": "high"|"medium"|"low", "note": string}
List levels top first. Use null for anything you cannot read; never guess a digit.`

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
  const { data: prof } = au.user
    ? await sb.from('users').select('active').eq('id', au.user.id).single()
    : { data: null }
  if (!prof?.active) return json({ error: 'Not authorised' }, 401)

  const mediaType = (req.headers.get('x-media-type') ?? req.headers.get('content-type') ?? '').split(';')[0].trim()
  if (!MEDIA.has(mediaType)) return json({ error: `Send a screenshot image (got ${mediaType || 'nothing'})` }, 415)
  const buf = new Uint8Array(await req.arrayBuffer())
  if (!buf.length) return json({ error: 'No image' }, 400)
  if (buf.length > 8 * 1024 * 1024) return json({ error: 'Image is over 8 MB' }, 413)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      // No extended thinking: it can spend the whole budget before the answer
      // starts, and it adds time the person spends waiting on this screen.
      thinking: { type: 'disabled' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: Buffer.from(buf).toString('base64') } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    }),
  })
  if (!res.ok) return json({ error: `Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}` }, 502)
  const reply = (await res.json()) as MessagesReply
  const text = replyText(reply)
  const problem = replyProblem(reply, text)
  if (problem) return json({ error: problem }, 502)
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  try {
    const p = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    const levels = (Array.isArray(p.levels) ? p.levels : [])
      .slice(0, 16)
      .map((l) => {
        const o = (l ?? {}) as Record<string, unknown>
        return { temp_c: num(o.temp_c), pct: o.no_data === true ? null : num(o.pct), no_data: o.no_data === true }
      })
    const kind = p.percent_kind === 'rh' || p.percent_kind === 'moisture' ? p.percent_kind : 'unknown'
    return json({
      bin_name: typeof p.bin_name === 'string' ? p.bin_name : null,
      crop: typeof p.crop === 'string' ? p.crop : null,
      ambient_temp_c: num(p.ambient_temp_c),
      bushels: num(p.bushels),
      percent_kind: kind,
      levels,
      confidence: p.confidence === 'high' || p.confidence === 'medium' ? p.confidence : 'low',
      note: typeof p.note === 'string' ? p.note : '',
    })
  } catch {
    return json({ error: 'Could not read the sensors off that screenshot' }, 422)
  }
}
