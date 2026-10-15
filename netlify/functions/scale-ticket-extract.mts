import { createClient } from '@supabase/supabase-js'
import { replyProblem, replyText, type MessagesReply } from '../shared/anthropic-reply.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { withFarm } from '../../src/lib/farm-context.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

/**
 * Read a scale ticket.
 *
 * A photo of the ticket from the truck, or the PDF the buyer emails, in; the
 * figures out — gross, tare, net, moisture, dockage, the buyer's ticket number
 * and which contract it says it was against. The person then sees them beside
 * the ticket and presses Save. Every buyer prints a different ticket, and the
 * corn buyer and the bean buyer do not print the same one, so this reads the
 * ticket the way a person does rather than by where the numbers sit on the
 * page.
 *
 * Nothing is written from here. The browser saves the row with the person's
 * own login once they have checked it.
 */
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let apiKey = process.env.ANTHROPIC_API_KEY
let model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })

const IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export type TicketRead = {
  buyer: string | null
  ticket_no: string | null
  delivered_on: string | null
  commodity: string | null
  gross_lb: number | null
  tare_lb: number | null
  net_lb: number | null
  moisture_pct: number | null
  dockage_pct: number | null
  /** Grain protein, % — on wheat and durum grade tickets. */
  protein_pct: number | null
  /** The ticket's own net figure in its own unit, if it prints one. */
  net_stated: number | null
  net_stated_unit: 'bu' | 'lb' | 'cwt' | 'kg' | 'tonne' | null
  contract_no: string | null
  notes: string | null
  unsure: string[]
}

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

  const mediaType = (req.headers.get('x-media-type') ?? req.headers.get('content-type') ?? '')
    .split(';')[0]
    .trim()
  const isPdf = mediaType === 'application/pdf'
  if (!isPdf && !IMAGES.has(mediaType)) return json({ error: `Send a photo or a PDF (got ${mediaType || 'nothing'})` }, 415)
  const buf = new Uint8Array(await req.arrayBuffer())
  if (!buf.length) return json({ error: 'No file' }, 400)
  if (buf.length > 10 * 1024 * 1024) return json({ error: 'File is over 10 MB' }, 413)
  const data = Buffer.from(buf).toString('base64')

  const prompt = `This is a grain scale ticket (weigh ticket / delivery receipt) from a buyer in southern Alberta. The farm delivers CORN (sold by the bushel, 56 lb/bu) and DRY BEANS (pinto, black, great northern, yellow — sold by the pound or cwt). Read it.

Return ONLY this JSON, no prose:
{"buyer":string|null,"ticket_no":string|null,"delivered_on":"YYYY-MM-DD"|null,"commodity":string|null,"gross_lb":number|null,"tare_lb":number|null,"net_lb":number|null,"moisture_pct":number|null,"dockage_pct":number|null,"protein_pct":number|null,"net_stated":number|null,"net_stated_unit":"bu"|"lb"|"cwt"|"kg"|"tonne"|null,"contract_no":string|null,"notes":string|null,"unsure":string[]}

Rules:
- Weights in POUNDS. If the ticket is in kg, convert (1 kg = 2.20462 lb) and say so in notes.
- net_stated is the ticket's own settlement quantity if it prints one (e.g. "Net Bu 1,234.5" or "Net Cwt 412.20"), in the unit it prints. Leave null if it only prints weights.
- dockage_pct: dockage, foreign material, splits, pick — whichever the ticket uses for the deduction; say which in notes.
- protein_pct: grain protein (%), usually on wheat and durum grade lines. Null if not printed.
- contract_no: any contract/PO/reference number printed on the ticket.
- Anything you could not read cleanly goes in unsure, in plain words.
- Never invent a number. Null beats a guess.`

  const content = isPdf
    ? [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
        { type: 'text', text: withFarm(prompt) },
      ]
    : [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: withFarm(prompt) },
      ]

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
      messages: [{ role: 'user', content }],
    }),
  })
  if (!res.ok) return json({ error: `Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}` }, 502)
  const reply = (await res.json()) as MessagesReply
  const text = replyText(reply)
  const problem = replyProblem(reply, text)
  if (problem) return json({ error: problem }, 502)
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return json({ error: 'Could not read that as a ticket' }, 422)

  let p: Partial<TicketRead>
  try {
    p = JSON.parse(text.slice(start, end + 1)) as Partial<TicketRead>
  } catch {
    return json({ error: 'Could not read that as a ticket' }, 422)
  }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const units = ['bu', 'lb', 'cwt', 'kg', 'tonne'] as const
  const out: TicketRead = {
    buyer: str(p.buyer),
    ticket_no: str(p.ticket_no),
    delivered_on: typeof p.delivered_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.delivered_on) ? p.delivered_on : null,
    commodity: str(p.commodity),
    gross_lb: num(p.gross_lb),
    tare_lb: num(p.tare_lb),
    net_lb: num(p.net_lb) ?? (num(p.gross_lb) != null && num(p.tare_lb) != null ? num(p.gross_lb)! - num(p.tare_lb)! : null),
    moisture_pct: num(p.moisture_pct),
    dockage_pct: num(p.dockage_pct),
    protein_pct: num(p.protein_pct),
    net_stated: num(p.net_stated),
    net_stated_unit: units.includes(p.net_stated_unit as (typeof units)[number]) ? (p.net_stated_unit as TicketRead['net_stated_unit']) : null,
    contract_no: str(p.contract_no),
    notes: str(p.notes),
    unsure: Array.isArray(p.unsure) ? p.unsure.map(String).slice(0, 6) : [],
  }
  return json(out)
}
