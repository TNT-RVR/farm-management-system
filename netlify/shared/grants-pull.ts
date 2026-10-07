import type { SupabaseClient } from '@supabase/supabase-js'
import { farmProvince, farmProvinceName } from '../../src/lib/farm-context.ts'

// Shared by the scheduled pull (grants-pull.mts) and the on-demand background
// pull (grants-pull-background.mts). Asks Claude (with web search) for currently
// open Alberta farm/cattle grants and upserts new ones (dedup by url) — new rows
// fire the grants insert trigger → managers get a "new grant" notification.
const PROMPT = `Search the web for grants, rebates, and cost-share funding programs that are CURRENTLY OPEN (accepting applications) and that apply to a farm or cattle/beef operation in Alberta, Canada. Include Alberta provincial (e.g. Sustainable CAP streams), federal (e.g. On-Farm Climate Action Fund, AgriInvest/AgriStability where relevant), and reputable regional/industry programs. Focus on crop farming and cattle ranching.

Return ONLY a JSON array (no prose) where each item is:
{"title": string, "funder": string, "url": string, "amount_min": number|null, "amount_max": number|null, "eligibility_summary": string (1-2 sentences), "summary": string (1 sentence), "closes_on": "YYYY-MM-DD"|null, "region": "Alberta"|"Canada", "categories": string[]}
Use null for unknown amounts/dates. Only include programs you found evidence are open. Output the JSON array and nothing else.`

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

export async function runGrantsPull(
  sb: SupabaseClient,
  apiKey: string,
  model: string,
): Promise<{ found: number; inserted: number }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
      messages: [{ role: 'user', content: grantsPrompt() }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end < 0) throw new Error('no JSON array in reply')
  const items = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>[]

  let inserted = 0
  for (const g of items) {
    const grantUrl = typeof g.url === 'string' ? g.url : null
    if (!g.title || !grantUrl) continue
    const row = {
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
      source: 'auto',
      external_key: grantUrl, // dedup: same url won't re-insert or re-notify
    }
    const { error, count } = await sb
      .from('grants')
      .upsert(row, { onConflict: 'external_key', ignoreDuplicates: true, count: 'exact' })
    if (!error && count) inserted += count
  }
  return { found: items.length, inserted }
}
