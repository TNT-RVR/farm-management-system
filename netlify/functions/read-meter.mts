import { createClient } from '@supabase/supabase-js'
import { replyProblem, replyText, type MessagesReply } from '../shared/anthropic-reply.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

/**
 * Read a number off a photograph.
 *
 * The hour meter on a machine, mostly — a service gets logged from the cab with
 * a photo of the dash rather than a number typed from memory in the shop a
 * week later. The same reader answers for a scale ticket's net weight or a
 * tank gauge; the caller says what it is looking at.
 *
 * The photo is not stored. It is read, the number comes back, and the person
 * sees it beside the box before anything is saved — a misread 4 for a 9 is
 * caught by the eye that took the photo, not by a trigger later.
 */
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let apiKey = process.env.ANTHROPIC_API_KEY
let model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })

const MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

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
  if (!MEDIA.has(mediaType)) return json({ error: `Send a photo (got ${mediaType || 'nothing'})` }, 415)
  const what = req.headers.get('x-reading') ?? 'engine hour meter'
  const buf = new Uint8Array(await req.arrayBuffer())
  if (!buf.length) return json({ error: 'No photo' }, 400)
  if (buf.length > 8 * 1024 * 1024) return json({ error: 'Photo is over 8 MB' }, 413)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      // No extended thinking: it can spend the whole budget before the answer
      // starts, and it adds time the person spends waiting on this screen.
      thinking: { type: 'disabled' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: Buffer.from(buf).toString('base64') } },
            {
              type: 'text',
              text: `This is a photo of a farm machine's ${what}. Read the number it shows. Tenths after a decimal point count; digits in a different colour at the right-hand end are usually tenths. Ignore other numbers on the dash (RPM, speed, temperature). Return ONLY JSON: {"value": number|null, "confidence": "high"|"medium"|"low", "note": string}. Null if it cannot be read.`,
            },
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
    const parsed = JSON.parse(text.slice(start, end + 1)) as { value?: unknown; confidence?: string; note?: string }
    const value = typeof parsed.value === 'number' && Number.isFinite(parsed.value) ? parsed.value : null
    return json({ value, confidence: parsed.confidence ?? 'low', note: parsed.note ?? '' })
  } catch {
    return json({ error: 'Could not read a number off that photo' }, 422)
  }
}
