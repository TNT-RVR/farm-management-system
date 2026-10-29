import { replyProblem, replyText, type MessagesReply } from '../shared/anthropic-reply.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { withFarm } from '../../src/lib/farm-context.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'
import { admin } from '../shared/supabase-admin.ts'
import { callClaude, SONNET_5 } from '../shared/anthropic.ts'
import { isStaff } from '../shared/staff.ts'

/**
 * Combines → Starting settings → Conditions: Claude's read of the rules
 * engine's suggestions (src/lib/combine-conditions.ts).
 *
 * The suggestions are worked out in the page by named rules, so the model
 * never invents a setting: it is given the crop, the satellite thickness, the
 * grain moisture, the weather and the rules' output, and asked only which
 * change to try first and why, in plain words. A sync call the person waits
 * on, so thinking is off (shared/anthropic-reply.ts).
 */
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let apiKey = process.env.ANTHROPIC_API_KEY
let model = process.env.ANTHROPIC_MODEL ?? SONNET_5

export const config = { path: '/api/combine-advice' }

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })

const SYSTEM = `You help a combine operator running a New Holland CR (twin rotor) decide which setting change to try first.
You are given the crop, how thick it is from satellite NDVI, the grain moisture, the weather at the field, and suggestions already worked out by a rules engine from the operator's manual and extension guidance. Each suggestion has the setting, what it is set at now, a direction ("+1 step", "open a step", "slower", "hold", "check", "as is") and the reasons.
Your job is only to explain and prioritise those suggestions: which one to try first, which next, and why, given the conditions. Rules you must keep:
- Never suggest a setting, a direction or a change that is not in the suggestions. Never give a number for a setting (no rpm, mm, inches or mph values) beyond copying what it is set at now.
- Where a suggestion says "hold", say the rules disagree and the loss check decides.
- If the "later_today" notes say the air or grain turns tough, say what to expect and when, in the operator's words.
- One change at a time, then a kill-stop and a loss check before the next.
- Only mention what you are given.
Write 3–6 short bullet points starting with "- ", plain language read on a phone in the cab. Lead with the first change to try. Bold at most a few words with **. No preamble, no headings.`

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
  const { data: prof } = au.user ? await sb.from('users').select('active, role').eq('id', au.user.id).single() : { data: null }
  if (!isStaff(prof)) return json({ error: 'Not authorised' }, 401)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Send JSON' }, 400)
  }
  const text = JSON.stringify(body)
  if (text.length > 15_000) return json({ error: 'Too much to send' }, 413)

  const res = await callClaude({
    model,
    maxTokens: 900,
    // No extended thinking: the person is waiting in the cab, and thinking can spend the whole budget before the answer.
    thinking: { type: 'disabled' },
    system: withFarm(SYSTEM),
    messages: [{ role: 'user', content: `Conditions and the rules' suggestions (JSON):\n${text}` }],
  }, { apiKey })
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
