import { createClient } from '@supabase/supabase-js'
import { replyProblem, replyText, type MessagesReply } from '../shared/anthropic-reply.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { withFarm } from '../../src/lib/farm-context.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

/**
 * Something said in the cab, turned into a task or a field note.
 *
 * The phone does the listening (Web Speech in the browser) and sends the words
 * here; this asks the model to sort them into the shape the app already has —
 * a task with a field, a machine, people and a date, or a note against a
 * field. The person then sees the result and presses Save. NOTHING IS WRITTEN
 * FROM HERE: the browser writes it with the speaker's own login, so the task
 * is created by the person who spoke it and the row-level rules apply as they
 * do to a typed one.
 *
 * Names are matched HERE, not by the model: it is given the farm's own lists
 * of fields, people and machines, and is asked to pick ids from them rather
 * than invent names. "Kyle" has to become Kyle's id, and "the drill" the
 * drill's, or the task lands on nobody and nothing.
 */
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let apiKey = process.env.ANTHROPIC_API_KEY
let model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'

type Named = { id: string; name: string }
type Body = {
  transcript: string
  today: string
  fields: Named[]
  users: Named[]
  equipment: Named[]
  /** The field the phone is standing in, if it knows. */
  hereFieldId?: string | null
}

export type Captured = {
  kind: 'task' | 'note'
  title: string
  /** The rest of what was said, tidied. */
  detail: string
  field_id: string | null
  equipment_id: string | null
  assignee_ids: string[]
  /** YYYY-MM-DD, or null. */
  due_on: string | null
  /** What the model was unsure of, said plainly for the person to check. */
  unsure: string[]
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })

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

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return json({ error: 'Expected JSON' }, 400)
  }
  const transcript = (body.transcript ?? '').trim()
  if (!transcript) return json({ error: 'Nothing was said' }, 400)

  const list = (xs: Named[]) => xs.map((x) => `- ${x.id} :: ${x.name}`).join('\n') || '- (none)'
  const prompt = `Somebody on a farm in southern Alberta just said this into their phone:

"""${transcript.slice(0, 2000)}"""

Today is ${body.today}. ${body.hereFieldId ? `The phone is currently in the field with id ${body.hereFieldId}.` : 'The phone does not know which field it is in.'}

Turn it into ONE of:
- a TASK: something to be done, possibly by somebody, possibly by a date ("get Kyle to change the drill's openers before Friday").
- a NOTE: an observation about a field with nothing to do ("north end of 12 is lodging").

FIELDS (id :: name):
${list(body.fields)}

PEOPLE (id :: name):
${list(body.users)}

MACHINES (id :: name):
${list(body.equipment)}

Rules:
- Use ONLY ids from the lists above. If a name is not on a list, leave the id null and say so in "unsure".
- "here", "this field", "this one" mean the field the phone is in, if known.
- Dates: resolve "Friday", "tomorrow", "end of the week" from today's date to YYYY-MM-DD; null if no date was said.
- The title is short and in the farm's words — what would be read off a to-do list. The detail keeps the rest of what was said, tidied but not embellished.
- Do not invent anything that was not said.

Return ONLY this JSON, no prose:
{"kind":"task"|"note","title":string,"detail":string,"field_id":string|null,"equipment_id":string|null,"assignee_ids":string[],"due_on":"YYYY-MM-DD"|null,"unsure":string[]}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      // No extended thinking: it can spend the whole budget before the answer
      // starts, and it adds time the person spends waiting on this screen.
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: withFarm(prompt) }],
    }),
  })
  if (!res.ok) return json({ error: `Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}` }, 502)
  const reply = (await res.json()) as MessagesReply
  const text = replyText(reply, '\n')
  const problem = replyProblem(reply, text)
  if (problem) {
    console.error('[voice] unusable reply:', JSON.stringify(reply).slice(0, 800))
    return json({ error: problem }, 502)
  }
  // The reply, with any code fence stripped, and the raw text kept for the
  // error — "not the expected shape" on its own is useless at a phone.
  const stripped = text.replace(/```(?:json)?/g, '').trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  const unexpected = () => {
    console.error('[voice] unexpected reply:', JSON.stringify(reply).slice(0, 800))
    return json(
      { error: `Could not sort that out — the reply was: ${(stripped || JSON.stringify(reply)).slice(0, 200)}` },
      502,
    )
  }
  if (start < 0 || end < start) return unexpected()

  let parsed: Partial<Captured>
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1)) as Partial<Captured>
  } catch {
    return unexpected()
  }

  // Checked here as well as asked for: an id the model made up must not reach
  // an insert, and a stale one from an old list must not either.
  const has = (xs: Named[], id: unknown) => typeof id === 'string' && xs.some((x) => x.id === id)
  const out: Captured = {
    kind: parsed.kind === 'note' ? 'note' : 'task',
    title: String(parsed.title ?? transcript).slice(0, 200),
    detail: String(parsed.detail ?? '').slice(0, 2000),
    field_id: has(body.fields, parsed.field_id) ? (parsed.field_id as string) : null,
    equipment_id: has(body.equipment, parsed.equipment_id) ? (parsed.equipment_id as string) : null,
    assignee_ids: Array.isArray(parsed.assignee_ids)
      ? parsed.assignee_ids.filter((id) => has(body.users, id))
      : [],
    due_on:
      typeof parsed.due_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.due_on) ? parsed.due_on : null,
    unsure: Array.isArray(parsed.unsure) ? parsed.unsure.map(String).slice(0, 5) : [],
  }
  return json(out)
}
