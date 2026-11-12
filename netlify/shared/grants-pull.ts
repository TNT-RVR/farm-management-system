import type { SupabaseClient } from '@supabase/supabase-js'
import { farmProvince, farmProvinceName } from '../../src/lib/farm-context.ts'
import { callClaude } from './anthropic.ts'

// Shared by the scheduled pull (grants-pull.mts) and the on-demand background
// pull (grants-pull-background.mts). Asks Claude (with web search) for currently
// open Alberta farm/cattle grants.
//
// A result we already hold tops that grant up instead of becoming a row of its
// own. That used to be judged on the url alone, and the search lands on a
// different page about the same programme most weeks -- rdar.ca/ofcaf one week,
// rdar.ca/applying-for-ofcaf the next -- which is how the list came to hold the
// On-Farm Climate Action Fund five times. grant_find_match now asks the
// database, which knows the pages we have folded away and the programme each
// title names.
const PROMPT = `Search the web for grants, rebates, and cost-share funding programs that are CURRENTLY OPEN (accepting applications) and that apply to a farm or cattle/beef operation in Alberta, Canada. Include Alberta provincial (e.g. Sustainable CAP streams), federal (e.g. On-Farm Climate Action Fund, AgriInvest/AgriStability where relevant), and reputable regional/industry programs. Focus on crop farming and cattle ranching.

Return ONLY a JSON array (no prose) where each item is:
{"title": string, "funder": string, "url": string, "amount_min": number|null, "amount_max": number|null, "eligibility_summary": string (1-2 sentences), "summary": string (1 sentence), "closes_on": "YYYY-MM-DD"|null, "region": "Alberta"|"Canada", "categories": string[]}
Use null for unknown amounts/dates. Only include programs you found evidence are open. Output the JSON array and nothing else.`

/** How the already-tracked programmes are put to the model. */
const KNOWN_PREAMBLE = `We already track the programs listed below. Do not return a program that is already on this list, even under a different name, a different delivery partner, or a different page of the same program's website — list only programs that are not there at all. Name each program the way its own administrator names it, without a trailing qualifier such as "(Sustainable CAP)" or "- General".

Already tracked:
`

/**
 * The prompt for this farm's province: word for word the Alberta one for an
 * Alberta farm (it names Alberta's own programs), otherwise the same request
 * pointed at the farm's province or state from Farm setup.
 */
function grantsPrompt(): string {
  if (farmProvince() === 'AB') return PROMPT
  const where = farmProvinceName()
  return PROMPT.replace('in Alberta, Canada', `in ${where}`)
    .replace('Include Alberta provincial (e.g. Sustainable CAP streams)', `Include ${where} provincial or state`)
    .replace('"region": "Alberta"|"Canada"', `"region": "${where}"|"national"`)
}

/** A line per grant we hold, so the search does not go and find it again. */
function knownBlock(known: { title: string; funder: string | null }[]): string {
  if (!known.length) return ''
  const lines = known
    .map((g) => `- ${g.title}${g.funder ? ` (${g.funder})` : ''}`)
    .join('\n')
  return `${KNOWN_PREAMBLE}${lines}\n\n`
}

/** Fields worth taking from a fresh listing, when ours has a blank. */
type Found = {
  title: string
  funder: string | null
  url: string
  amount_min: number | null
  amount_max: number | null
  eligibility_summary: string | null
  summary: string | null
  closes_on: string | null
  region: string
  categories: string[]
}

export async function runGrantsPull(
  sb: SupabaseClient,
  apiKey: string,
  model: string,
): Promise<{ found: number; inserted: number; updated: number; merged: number }> {
  // What we already hold goes into the prompt, so the search spends its effort
  // on programs we are missing rather than re-describing the ones we have.
  const { data: known } = await sb
    .from('grants')
    .select('title, funder')
    .not('status', 'in', '("declined","ignored")')
    .order('title')

  const res = await callClaude({
    model,
    maxTokens: 4096,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
    messages: [{ role: 'user', content: knownBlock(known ?? []) + grantsPrompt() }],
  }, { apiKey })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end < 0) throw new Error('no JSON array in reply')
  const items = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>[]

  let inserted = 0
  let updated = 0
  for (const g of items) {
    const grantUrl = typeof g.url === 'string' ? g.url : null
    if (!g.title || !grantUrl) continue
    const row: Found = {
      title: String(g.title).slice(0, 300),
      funder: g.funder ? String(g.funder) : null,
      url: grantUrl,
      amount_min: typeof g.amount_min === 'number' ? g.amount_min : null,
      amount_max: typeof g.amount_max === 'number' ? g.amount_max : null,
      eligibility_summary: g.eligibility_summary ? String(g.eligibility_summary) : null,
      summary: g.summary ? String(g.summary) : null,
      closes_on:
        typeof g.closes_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(g.closes_on) ? g.closes_on : null,
      region: g.region ? String(g.region) : farmProvinceName(),
      categories: Array.isArray(g.categories) ? (g.categories as string[]).map(String) : [],
    }

    const { data: matchId } = await sb.rpc('grant_find_match', {
      p_title: row.title,
      p_url: grantUrl,
    })

    if (matchId) {
      // Ours already. Fill its blanks and remember this page, so neither this
      // week's wording nor next week's lands as a second row.
      const topUp = await fillBlanks(sb, matchId as string, row)
      if (topUp) updated++
      await sb
        .from('grant_aliases')
        .upsert({ external_key: grantUrl, grant_id: matchId as string, title: row.title },
                { onConflict: 'external_key' })
      continue
    }

    const { error, count } = await sb
      .from('grants')
      .upsert({ ...row, source: 'auto', external_key: grantUrl },
              { onConflict: 'external_key', ignoreDuplicates: true, count: 'exact' })
    // A new grant needs no alias: the page it was found on is its own
    // external_key until the day it gets merged into something else.
    if (!error && count) inserted += count
  }

  // A deadline that has passed is closed before anything is compared, so a
  // merge keeps the open listing's status rather than the lapsed one's. Then
  // fold away anything that slipped through as a second listing anyway.
  await sb.rpc('fn_close_expired_grants')
  const { data: merged } = await sb.rpc('fn_dedupe_grants')

  return { found: items.length, inserted, updated, merged: Number(merged ?? 0) }
}

/**
 * Writes the fresh listing's values into the grant's empty fields only.
 *
 * Never over-writes: what is on the grant was either checked by the details
 * lookup against the program's own pages or typed by somebody here, and a web
 * search's one-line summary is not better than either. The deadline is the one
 * exception — a later date on the same program is the window being extended,
 * which is the thing we most need to know.
 */
async function fillBlanks(sb: SupabaseClient, id: string, row: Found): Promise<boolean> {
  const { data: cur } = await sb
    .from('grants')
    .select('funder, url, amount_min, amount_max, eligibility_summary, summary, closes_on, region, categories')
    .eq('id', id)
    .single()
  if (!cur) return false

  const patch: Record<string, unknown> = {}
  const keep = ['funder', 'url', 'amount_min', 'amount_max', 'eligibility_summary', 'summary', 'region'] as const
  for (const k of keep) {
    if (cur[k] == null && row[k] != null) patch[k] = row[k]
  }
  if (row.closes_on && (!cur.closes_on || row.closes_on > cur.closes_on)) patch.closes_on = row.closes_on
  if (row.categories.length) {
    const merged = [...new Set([...(cur.categories ?? []), ...row.categories])]
    if (merged.length !== (cur.categories ?? []).length) patch.categories = merged
  }
  if (!Object.keys(patch).length) return false

  patch.updated_at = new Date().toISOString()
  const { error } = await sb.from('grants').update(patch).eq('id', id)
  return !error
}
