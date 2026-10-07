import type { SupabaseClient } from '@supabase/supabase-js'
import { farmDescription, farmProvinceName } from '../../src/lib/farm-context.ts'
// The same scorer the page uses. Imported rather than copied: two rankings
// that disagree about what matters would be worse than none.
import { scoreEvent } from '../../src/lib/events'

// Shared by the scheduled pull (events-pull.mts) and the on-demand background
// pull (events-pull-background.mts). Asks Claude (with web search) for upcoming
// conferences and trade shows worth this operation's time, and upserts them.
//
// Deduplication is on external_key, which is the event's URL plus the year it
// runs. A conference is a different event every year at the same address, so
// the URL alone would let the 2027 edition overwrite the 2026 one — and the URL
// plus year keeps a re-pull from duplicating the same show every Monday.

/**
 * What the search is told about the farm: its own description from Farm
 * setup, or this when it has none.
 *
 * Say what the farm does NOT do as plainly as what it does. Asked for "bee
 * events" a search returns beekeeping conferences about honey, hives and
 * queens; a farm with leafcutter bees for alfalfa seed needs seed-grower and
 * pollination meetings instead, and its description says so.
 */
const OPERATION = () => `A farm in ${farmProvinceName()}. It has not described its crops or livestock yet.`

const PROMPT = (today: string) => `${farmDescription(OPERATION())}

Today's date is ${today}. Every event you return must START ON OR AFTER this date — the NEXT edition, not the one that has already run. If you can only find last season's page, look for the upcoming dates or leave the date null; do not return the past edition's dates.

Search the web for conferences, trade shows, field days and industry meetings taking place in the NEXT 12 MONTHS that this operation should consider attending. Prioritise, in order:
1. Production of this farm's own crops and irrigation if it irrigates (especially events near the farm).
2. Any specialty enterprise the farm describes above (seed production, pollination and the like).
3. Agronomy and soil for the farm's region.
4. Its livestock and forage, if it keeps livestock.
5. Major farm equipment and ag-technology shows.
Mostly in ${farmProvinceName()} and the regions around it. Include an event farther away ONLY if it is an outstanding fit (for example a leading national conference on one of the farm's main enterprises).

Return ONLY a JSON array (no prose). Each item:
{"name": string, "organiser": string|null, "url": string, "starts_on": "YYYY-MM-DD"|null, "ends_on": "YYYY-MM-DD"|null, "registration_deadline": "YYYY-MM-DD"|null, "early_bird_deadline": "YYYY-MM-DD"|null, "venue": string|null, "city": string|null, "region": string|null, "country": string, "cost": number|null, "early_bird_cost": number|null, "currency": "CAD"|"USD", "cost_notes": string|null, "categories": string[], "why_go": string}

Rules:
- "categories" must come from this list only: irrigation, crop, agronomy, cattle, leafcutter, alfalfa-seed, ag-tech, equipment, business, soil, potato, pulse.
- "why_go" is one or two sentences on why THIS farm specifically would benefit. Be concrete.
- Use null for anything you could not confirm. Do NOT invent dates or prices — a null is far better than a guess.
- Only include events you found actual evidence for. Output the JSON array and nothing else.`

const ALLOWED = new Set([
  'irrigation',
  'crop',
  'agronomy',
  'cattle',
  'leafcutter',
  'alfalfa-seed',
  'ag-tech',
  'equipment',
  'business',
  'soil',
  'potato',
  'pulse',
])

const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export async function runEventsPull(
  sb: SupabaseClient,
  apiKey: string,
  model: string,
  now: Date = new Date(),
): Promise<{ found: number; inserted: number; skipped: number; stale: number }> {
  const today = now.toISOString().slice(0, 10)
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 10 }],
      messages: [{ role: 'user', content: PROMPT(today) }],
    }),
  })
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    // 401 and 403 mean the key is present and the API refused it — a different
    // problem from no key at all, and one nobody diagnoses from a raw body.
    if (res.status === 401 || res.status === 403)
      throw new Error(
        'Anthropic rejected the API key. It is set on the site but is expired, revoked, or from ' +
          'the wrong account — replace ANTHROPIC_API_KEY and redeploy.',
      )
    if (res.status === 429)
      throw new Error('Anthropic is rate limiting or the account is out of credit.')
    throw new Error(`Anthropic ${res.status}: ${detail}`)
  }

  const body = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = (body.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n')
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end < 0) throw new Error('no JSON array in reply')
  const items = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>[]

  let inserted = 0
  let skipped = 0
  let stale = 0

  for (const e of items) {
    const url = str(e.url)
    const name = str(e.name)
    // An event with no name or no page to check is not worth a row. Somebody
    // has to be able to verify it, and a bare name is not verifiable.
    if (!name || !url) {
      skipped++
      continue
    }
    const startsOn = isDate(e.starts_on) ? e.starts_on : null
    const endsOn = isDate(e.ends_on) ? e.ends_on : null
    // Dropped outright. Asking nicely in the prompt is not enough — the first
    // run came back with ten events, every one of which had already happened.
    const last = endsOn ?? startsOn
    if (last && last < today) {
      stale++
      continue
    }
    const year = startsOn?.slice(0, 4) ?? 'undated'

    const categories = Array.isArray(e.categories)
      ? [...new Set((e.categories as unknown[]).map(String).filter((c) => ALLOWED.has(c)))]
      : []

    const row = {
      name: name.slice(0, 300),
      organiser: str(e.organiser),
      url,
      starts_on: startsOn,
      ends_on: endsOn,
      registration_deadline: isDate(e.registration_deadline) ? e.registration_deadline : null,
      early_bird_deadline: isDate(e.early_bird_deadline) ? e.early_bird_deadline : null,
      venue: str(e.venue),
      city: str(e.city),
      region: str(e.region),
      country: str(e.country) ?? 'Canada',
      cost: numOrNull(e.cost),
      early_bird_cost: numOrNull(e.early_bird_cost),
      currency: str(e.currency) === 'USD' ? 'USD' : 'CAD',
      cost_notes: str(e.cost_notes),
      categories,
      why_go: str(e.why_go),
      relevance: scoreEvent({
        categories,
        city: str(e.city),
        region: str(e.region),
        country: str(e.country) ?? 'Canada',
      }),
      source: 'auto',
      // Same show next year is a new row; the same show re-found next Monday
      // is not.
      external_key: `${url}#${year}`,
    }

    // ignoreDuplicates, so a person's edits to status, notes or relevance are
    // never overwritten by the weekly search finding the event again.
    const { error, count } = await sb
      .from('events')
      .upsert(row, { onConflict: 'external_key', ignoreDuplicates: true, count: 'exact' })
    if (!error && count) inserted += count
  }

  return { found: items.length, inserted, skipped, stale }
}
