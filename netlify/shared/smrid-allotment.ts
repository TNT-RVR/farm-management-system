import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * SMRID's allotment, read from the district's own notices.
 *
 * SMRID posts every change on smrid.com in the same words — "raise the water
 * allocation to 16 inches at the farm gate for the 2026 irrigation season" —
 * so the newest notice that names an allocation for a season is the figure.
 * The contract (18 in) and other numbers of inches in a notice are ignored:
 * only an allocation being set, raised or lowered counts.
 */

export type SmridPost = { date: string; title: string; link: string; text: string }
export type SmridAllotment = { year: number; inches: number; date: string; title: string; link: string; sentence: string }

const ALLOCATION =
  /\b(?:allocation|allotment)\b[^.]{0,60}?\b(?:to|of|at|is|be|will be|set at|remains? at)\s+(\d{1,2}(?:\.\d{1,2})?)\s*(?:inches|inch|in\.|")(?:[^.]{0,80}?\b(20\d{2})\b)?/i

/** The allocation a notice sets, if it sets one. */
export function readAllocation(post: SmridPost): SmridAllotment | null {
  for (const sentence of post.text.split(/(?<=[.!?])\s+/)) {
    if (/contract/i.test(sentence) && !/raise|lower|reduce|increase|set/i.test(sentence)) continue
    const m = ALLOCATION.exec(sentence)
    if (!m) continue
    const inches = Number(m[1])
    if (!(inches > 0 && inches <= 24)) continue
    return { year: m[2] ? Number(m[2]) : Number(post.date.slice(0, 4)), inches, date: post.date, title: post.title, link: post.link, sentence: sentence.trim() }
  }
  return null
}

/** The latest allocation per season across the notices, oldest first, with the trail of changes. */
export function latestAllocations(posts: SmridPost[]): { year: number; latest: SmridAllotment; trail: SmridAllotment[] }[] {
  const byYear = new Map<number, SmridAllotment[]>()
  for (const p of posts) {
    const a = readAllocation(p)
    if (a) byYear.set(a.year, [...(byYear.get(a.year) ?? []), a])
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, list]) => {
      const trail = [...list].sort((a, b) => a.date.localeCompare(b.date))
      return { year, latest: trail[trail.length - 1], trail }
    })
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim()

export async function fetchSmridPosts(): Promise<SmridPost[]> {
  const r = await fetch('https://smrid.com/wp-json/wp/v2/posts?per_page=30&_fields=date,link,title,content', { headers: { 'user-agent': 'RVR-Management/1.0 (SMRID allotment)' } })
  if (!r.ok) throw new Error(`${r.status} from smrid.com`)
  const j = (await r.json()) as { date: string; link: string; title: { rendered: string }; content: { rendered: string } }[]
  return j.map((p) => ({ date: p.date.slice(0, 10), title: decode(p.title.rendered), link: p.link, text: decode(p.content.rendered) }))
}

/**
 * Bring water_allotments up to what SMRID last announced for this season and
 * last, and tell the managers when the figure moves. The contract figure on
 * file is kept.
 */
export async function syncSmridAllotment(sb: SupabaseClient, managerIds: () => Promise<string[]>): Promise<{ changed: string[]; seen: string }> {
  const posts = await fetchSmridPosts()
  const thisYear = new Date().getUTCFullYear()
  const found = latestAllocations(posts).filter((a) => a.year >= thisYear - 1)
  const changed: string[] = []
  for (const a of found) {
    const { data: row } = await sb.from('water_allotments').select('inches, contract_inches').eq('year', a.year).eq('source', 'smrid').maybeSingle()
    const trail = a.trail.map((t) => `${t.inches} in on ${t.date}`).join(', ')
    const note = `From SMRID's notice ${a.latest.date} "${a.latest.title}": ${a.latest.inches} in at the farm gate. This season: ${trail}.`
    if (row && Number(row.inches) === a.latest.inches) {
      await sb.from('water_allotments').update({ note, source_url: a.latest.link }).eq('year', a.year).eq('source', 'smrid')
      continue
    }
    const { error } = await sb.from('water_allotments').upsert(
      { year: a.year, source: 'smrid', inches: a.latest.inches, contract_inches: row?.contract_inches ?? 18, note, source_url: a.latest.link, updated_at: new Date().toISOString() },
      { onConflict: 'year,source' },
    )
    if (error) throw error
    changed.push(`${a.year}: ${row ? `${Number(row.inches)} → ` : ''}${a.latest.inches} in`)
    const ids = await managerIds()
    if (ids.length)
      await sb.from('notifications').insert(
        ids.map((user_id) => ({
          user_id,
          kind: 'smrid_allotment',
          title: `SMRID allotment ${a.year}: ${a.latest.inches} inches${row ? ` (was ${Number(row.inches)})` : ''}`,
          body: a.latest.sentence.slice(0, 400),
          link: '/irrigation?view=allocation',
        })),
      )
  }
  return { changed, seen: found.map((a) => `${a.year} ${a.latest.inches} in (${a.latest.date})`).join('; ') }
}
