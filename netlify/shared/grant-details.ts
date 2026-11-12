import type { SupabaseClient } from '@supabase/supabase-js'
import { farmProvinceName } from '../../src/lib/farm-context.ts'
import { callClaude } from './anthropic.ts'

/**
 * The facts it takes to act on one grant (Sam, 2 Nov 2026), read off the
 * program's own pages with Claude and web search: the deadline, the amount and
 * share it covers, who and what is eligible, who to contact, and the
 * application form. Only blanks are filled: anything a person has typed into a
 * grant stays as they left it. The form is saved to the grant-docs bucket when
 * it is a PDF, so it can be attached to a Claude chat without hunting for it.
 */

type GrantForLookup = {
  id: string
  title: string
  funder: string | null
  url: string | null
  closes_on: string | null
  opens_on: string | null
  amount_min: number | null
  amount_max: number | null
  cost_share_pct: number | null
  eligibility_summary: string | null
  eligible_costs: string | null
  summary: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  application_url: string | null
  application_pdf_path: string | null
}

const COLUMNS =
  'id, title, funder, url, closes_on, opens_on, amount_min, amount_max, cost_share_pct, eligibility_summary, eligible_costs, summary, contact_name, contact_email, contact_phone, application_url, application_pdf_path'

function prompt(g: GrantForLookup): string {
  return `Look up this funding program on the web, using its official pages first:

Program: ${g.title}
${g.funder ? `Funder: ${g.funder}\n` : ''}${g.url ? `Program page: ${g.url}\n` : ''}Applicant: a crop and cattle farm in ${farmProvinceName()}.

Find, for the intake that is open now or opens next:
- the application deadline and opening date
- the funding amount (minimum and maximum per applicant, in dollars)
- the share of eligible project costs it pays, as a percentage (e.g. 50 for 50% cost-share)
- who is eligible to apply, in 1-2 sentences
- what it pays for (eligible expenses), in 1-2 sentences
- the program contact: a person or office name, an email address and a phone number
- the application form: a direct link to the form itself, preferring a PDF; otherwise the online application or the applicant guide

Return ONLY a JSON object, no prose:
{"closes_on": "YYYY-MM-DD"|null, "opens_on": "YYYY-MM-DD"|null, "amount_min": number|null, "amount_max": number|null, "cost_share_pct": number|null, "eligibility_summary": string|null, "eligible_costs": string|null, "contact_name": string|null, "contact_email": string|null, "contact_phone": string|null, "application_url": string|null}
Use null for anything you could not confirm from a source. Never invent an email address or phone number.`
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const str = (v: unknown, max = 600) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

/** What the lookup found, cleaned: wrong types and made-up shapes become null. */
export function parseDetails(text: string): Partial<GrantForLookup> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('no JSON object in reply')
  const o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  const email = str(o.contact_email, 200)
  const link = str(o.application_url, 1000)
  const pct = num(o.cost_share_pct)
  return {
    closes_on: typeof o.closes_on === 'string' && DAY.test(o.closes_on) ? o.closes_on : null,
    opens_on: typeof o.opens_on === 'string' && DAY.test(o.opens_on) ? o.opens_on : null,
    amount_min: num(o.amount_min),
    amount_max: num(o.amount_max),
    cost_share_pct: pct != null && pct > 0 && pct <= 100 ? pct : null,
    eligibility_summary: str(o.eligibility_summary),
    eligible_costs: str(o.eligible_costs),
    contact_name: str(o.contact_name, 200),
    contact_email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    contact_phone: str(o.contact_phone, 60),
    application_url: link && /^https?:\/\//i.test(link) ? link : null,
  }
}

/** The found values for the columns still blank on the grant; nothing a person filled is touched. */
export function blanksOnly(g: GrantForLookup, found: Partial<GrantForLookup>): Partial<GrantForLookup> {
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(found)) {
    if (v == null) continue
    const cur = (g as Record<string, unknown>)[k]
    if (cur == null || cur === '') patch[k] = v
  }
  return patch as Partial<GrantForLookup>
}

/** The form, when the link really is a PDF (by its type or its first bytes). Null for a web page. */
async function fetchPdf(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'Mozilla/5.0 (grant application lookup)' } })
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    const isPdf = (res.headers.get('content-type') ?? '').includes('pdf') || new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-'
    if (!isPdf || bytes.length > 25 * 1024 * 1024) return null
    return bytes
  } catch {
    return null
  }
}

export async function lookUpGrantDetails(
  sb: SupabaseClient,
  apiKey: string,
  model: string,
  grantId: string,
): Promise<{ filled: string[]; pdf: boolean }> {
  const { data: g, error } = await sb.from('grants').select(COLUMNS).eq('id', grantId).single<GrantForLookup>()
  if (error || !g) throw new Error(error?.message ?? 'grant not found')

  const res = await callClaude(
    {
      model,
      maxTokens: 2048,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
      messages: [{ role: 'user', content: prompt(g) }],
    },
    { apiKey },
  )
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')
  const patch: Record<string, unknown> = blanksOnly(g, parseDetails(text))

  // The form itself, saved once: a person's own upload is never replaced.
  let pdf = false
  const formUrl = (patch.application_url as string | undefined) ?? g.application_url
  if (!g.application_pdf_path && formUrl) {
    const bytes = await fetchPdf(formUrl)
    if (bytes) {
      const path = `${g.id}/application.pdf`
      const up = await sb.storage.from('grant-docs').upload(path, bytes, { contentType: 'application/pdf', upsert: true })
      if (!up.error) {
        patch.application_pdf_path = path
        pdf = true
      }
    }
  }

  const filled = Object.keys(patch)
  const { error: upErr } = await sb
    .from('grants')
    .update({ ...patch, details_checked_at: new Date().toISOString(), ...(filled.length ? { updated_at: new Date().toISOString() } : {}) })
    .eq('id', g.id)
  if (upErr) throw new Error(upErr.message)
  return { filled, pdf }
}
