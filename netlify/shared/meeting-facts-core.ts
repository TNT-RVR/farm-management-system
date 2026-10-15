import type { SupabaseClient } from '@supabase/supabase-js'
import { farmDescription, farmProvinceName } from '../../src/lib/farm-context.ts'
import {
  FARM_FACTS,
  STOCK_PER_MONTH,
  TOPIC_LABEL,
  unusedForMonth,
  type FactTopic,
  type FarmFact,
} from '../../src/lib/farm-facts'

/**
 * Keeping the Monday-meeting fact library stocked, without anybody remembering to.
 *
 * Nothing is ever read out twice, so the library is consumed: 62 written facts
 * is about a year of Mondays, and the honest end of that road was a screen
 * saying "this needs a few more written for March". That is a job somebody has
 * to remember, and a job nobody has time for is a feature that quietly stops
 * working.
 *
 * So this tops it up — weeks ahead of need, a month at a time, and only for the
 * months that are actually running short.
 *
 * WHICH IS A REAL TRADE. The repo library was written and reviewed precisely
 * because a fact read out as farm policy has to be right, and one composed by a
 * model is right most of the time. Three things carry that weight instead:
 * every written fact is grounded by a web search and has to come back with the
 * source it was checked against, that source is a link on the card, and a fact
 * that turns out to be wrong is dropped in one press and never returns
 * (retire_meeting_fact). The reviewed library is still underneath all of it,
 * and is still what runs when there is no network.
 */

/** How many unused facts a month should always have in hand. Defined with the
 *  library itself, because the app reads the same number to decide when to ask
 *  for a top-up. */
export const TARGET_UNUSED_PER_MONTH = STOCK_PER_MONTH

/** Months topped up in one run. Two keeps a run short, and a weekly job still
 *  gets round the year several times over. */
export const MONTHS_PER_RUN = 2

/** New facts asked for in one go. Past about this many in a single reply, the
 *  later ones start restating the earlier ones. */
export const MAX_NEW_PER_MONTH = 6

/** How far ahead to care. Writing December facts in June is work done against a
 *  stock that may never be needed; six months is plenty of warning. */
export const LOOK_AHEAD_MONTHS = 6

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export type WrittenFact = {
  id: string
  topic: FactTopic
  title: string
  body: string
  so_what: string
  months: number[]
  source_url: string | null
}

/** A written row as the app's own library type. */
export const asFarmFact = (r: WrittenFact): FarmFact => ({
  id: r.id,
  topic: r.topic,
  title: r.title,
  body: r.body,
  soWhat: r.so_what,
  months: r.months,
})

/** What is left for each month, and how far short of the target it is. */
export function stockByMonth(library: FarmFact[], used: Set<string>) {
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const unused = unusedForMonth(library, used, month).length
    return { month, unused, short: Math.max(0, TARGET_UNUSED_PER_MONTH - unused) }
  })
}

/**
 * The months worth writing for now, soonest first.
 *
 * NEAREST FIRST, NOT EMPTIEST FIRST. A month five months out that is completely
 * bare still has twenty top-up runs ahead of it; this month being one short is
 * the one that reaches a meeting. Emptiest only breaks a tie.
 */
export function monthsNeedingFacts(
  library: FarmFact[],
  used: Set<string>,
  now: Date,
  perRun = MONTHS_PER_RUN,
): { month: number; unused: number; short: number }[] {
  const thisMonth = now.getMonth() + 1
  return stockByMonth(library, used)
    .map((s) => ({ ...s, away: (s.month - thisMonth + 12) % 12 }))
    .filter((s) => s.short > 0 && s.away < LOOK_AHEAD_MONTHS)
    .sort((a, b) => a.away - b.away || b.short - a.short)
    .slice(0, perRun)
    .map(({ month, unused, short }) => ({ month, unused, short }))
}

/** Words that carry no subject, so two titles are not "close" for sharing them. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'in', 'on', 'at', 'for', 'and',
  'or', 'but', 'not', 'it', 'its', 'that', 'this', 'than', 'then', 'with', 'without', 'you', 'your',
  'they', 'their', 'what', 'when', 'why', 'how', 'more', 'most', 'less', 'least', 'about', 'into',
  'out', 'up', 'down', 'off', 'by', 'from', 'as', 'no', 'one', 'two', 'per', 'can', 'will', 'does',
])

const words = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9%\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !STOPWORDS.has(w)),
  )

/**
 * Whether a proposed title says the same thing as one already in the library.
 *
 * Exact-match dedup is not enough here: "Swath canola at 60% seed colour change"
 * and "Canola: swath at 60 percent colour change" are the same fact read out on
 * two different Mondays, which is exactly what the log exists to prevent.
 * Compared on content words, so the wording may differ and the subject may not.
 */
export function titleTooClose(title: string, existing: string[], threshold = 0.6): boolean {
  const a = words(title)
  if (!a.size) return true
  return existing.some((e) => {
    const b = words(e)
    if (!b.size) return false
    let shared = 0
    for (const w of a) if (b.has(w)) shared++
    return shared / Math.min(a.size, b.size) >= threshold
  })
}

/** A readable id that has never been issued before — including to a fact that
 *  has since been dropped, because the log remembers ids forever. */
export function slugFor(title: string, taken: Set<string>): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .split('-')
      .filter(Boolean)
      .slice(0, 5)
      .join('-') || 'fact'
  if (!taken.has(base)) return base
  for (let n = 2; n < 500; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
  return `${base}-${Date.now()}`
}

const TOPICS = Object.keys(TOPIC_LABEL) as FactTopic[]

/**
 * A proposed fact, checked before it can ever be read out.
 *
 * Every rule here is a way of being wrong that would otherwise show up at the
 * meeting: a fact with no source cannot be checked by whoever hears it, a fact
 * for the wrong month is the seasonal filter defeated, a one-line body is not
 * worth reading aloud, and a missing "so what" is a quiz question.
 */
export function validateFact(
  raw: Record<string, unknown>,
  month: number,
  existingTitles: string[],
  taken: Set<string>,
): { fact: WrittenFact } | { reason: string } {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const title = str(raw.title)
  const body = str(raw.body)
  const soWhat = str(raw.so_what) || str(raw.soWhat)
  const topic = str(raw.topic).toLowerCase() as FactTopic
  const sourceUrl = str(raw.source_url) || str(raw.sourceUrl)

  if (!title || title.length > 120) return { reason: 'title missing or over-long' }
  if (body.length < 120) return { reason: `body too short (${body.length})` }
  if (body.length > 900) return { reason: `body too long (${body.length})` }
  if (soWhat.length < 20) return { reason: 'nothing to do about it' }
  if (!TOPICS.includes(topic)) return { reason: `unknown topic ${topic || '(none)'}` }
  if (!/^https?:\/\//i.test(sourceUrl)) return { reason: 'no source to check it against' }

  const months = Array.isArray(raw.months)
    ? [
        ...new Set(
          (raw.months as unknown[])
            .map(Number)
            .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12),
        ),
      ].sort((a, b) => a - b)
    : []
  if (!months.includes(month)) return { reason: `not a fact for ${MONTH_NAMES[month - 1]}` }
  // A fact that suits most of the year is an evergreen one in seasonal
  // clothing, and it would crowd out the months it does not really belong to.
  if (months.length > 6) return { reason: 'too many months to be seasonal' }
  if (titleTooClose(title, existingTitles)) return { reason: 'already covered' }

  return {
    fact: {
      id: slugFor(title, taken),
      topic,
      title,
      body,
      so_what: soWhat,
      months,
      source_url: sourceUrl,
    },
  }
}

/** Only for a farm that has not described itself on Farm setup. */
const OPERATION = () => `A farm in ${farmProvinceName()}. It has not described its crops or livestock yet, so keep each fact to what applies to most farms there.`

export function buildPrompt(month: number, count: number, avoid: string[]): string {
  const name = MONTH_NAMES[month - 1]
  return `${farmDescription(OPERATION())}

Write ${count} facts for the top of this farm's Monday morning meeting in ${name}.

They are read aloud to a crew of working farmers who already know how to farm. The bar is "I did not know that, and it changes what I do this month" — not a definition, not a safety slogan, and not something obvious to anybody who has run a sprayer.

Rules:
1. TIMED FOR ${name.toUpperCase()}. Each one must be something to act on within a few weeks of that month in ${farmProvinceName()} — the field operation, growth stage, cattle event or storage risk that is actually live then. Not a fact that happens to be true all year.
2. TRUE, AND CHECKABLE. Search the web and base each fact on published agronomy or beef research: provincial or state extension, the national agriculture department, commodity and beef research councils (in Canada: Agriculture and Agri-Food Canada, the Canola Council of Canada, the Beef Cattle Research Council), a university, or a product label. Return the URL you checked it against as source_url. If you cannot find a source for a claim, write a different fact rather than a vaguer one.
3. SPECIFIC NUMBERS where the number is the point (stage, temperature, moisture, rate, days, hours), and no invented numbers anywhere. A range is fine. Do not put a number on something the research does not put a number on.
4. ABOUT THIS OPERATION'S crops and livestock as described above, or the weather, spraying, storage and irrigation around them. Nothing about enterprises it does not have, or about farming conditions far from it.
5. NOT ALREADY COVERED. These are in the library already — do not write another fact on any of these subjects, however differently worded:
${avoid.map((t) => `- ${t}`).join('\n')}

Return ONLY a JSON array, no prose, each item:
{"topic": one of ${TOPICS.join('|')}, "title": a short sentence stating the fact, under 90 characters, "body": 3-4 sentences giving the fact and why it works, as it would be read aloud, "so_what": one or two sentences on what to do differently, "months": [the months 1-12 it is worth hearing in, including ${month}], "source_url": "https://..."}`
}

/** The JSON array out of a reply that may have prose around it. */
export function parseFacts(text: string): Record<string, unknown>[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end < start) return []
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : []
  } catch {
    return []
  }
}

async function askForFacts(
  apiKey: string,
  model: string,
  month: number,
  count: number,
  avoid: string[],
): Promise<Record<string, unknown>[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      // Grounded, not recalled. A fact read out as farm policy has to be
      // checkable, and the search is also what produces the source link.
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
      messages: [{ role: 'user', content: buildPrompt(month, count, avoid) }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = (body.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n')
  return parseFacts(text)
}

export type TopUpResult = {
  months: { month: string; asked: number; wrote: number; rejected: string[] }[]
  wrote: number
  library: number
}

/**
 * Top the library up.
 *
 * Does nothing at all when no month is short, which is the usual case — a run
 * with nothing to do costs two queries and no model call.
 */
export async function runFactTopUp(
  sb: SupabaseClient,
  apiKey: string,
  model: string,
  now = new Date(),
  /** Write for this month whether it is short or not. For proving the thing
   *  works without waiting months for a month to run down. */
  only?: { month: number; count: number },
): Promise<TopUpResult> {
  // One run an hour, however many people ask.
  //
  // The meeting page asks for a top-up whenever the month is thin, and on a
  // Monday morning that is five people opening the agenda at once — five runs
  // that all see the same short month and all write for it. The forced path
  // skips this, because that is the path used to prove it works.
  if (!only) {
    const { data: health } = await sb
      .from('integration_health')
      .select('last_checked_at')
      .eq('source_key', 'meeting_facts')
      .single()
    const since = health?.last_checked_at ? Date.now() - Date.parse(health.last_checked_at) : null
    if (since != null && since < 3_600_000) {
      return { months: [], wrote: 0, library: 0 }
    }
    // Claimed before the work rather than after it, so the second caller sees a
    // run in progress instead of the last one's timestamp.
    await sb
      .from('integration_health')
      .update({ last_checked_at: new Date().toISOString() })
      .eq('source_key', 'meeting_facts')
  }

  const [{ data: log, error: logErr }, { data: written, error: writtenErr }] = await Promise.all([
    sb.from('meeting_fact_log').select('fact_id'),
    sb.from('meeting_facts').select('id, topic, title, body, so_what, months, source_url, retired_at'),
  ])
  if (logErr) throw logErr
  if (writtenErr) throw writtenErr

  const rows = (written ?? []) as (WrittenFact & { retired_at: string | null })[]
  const library = [...FARM_FACTS, ...rows.filter((r) => !r.retired_at).map(asFarmFact)]
  const used = new Set((log ?? []).map((r) => (r as { fact_id: string }).fact_id))

  // Every id ever issued, dropped ones included: the log remembers ids forever,
  // so reusing one would silently resurrect "already read out".
  const taken = new Set<string>([...FARM_FACTS.map((f) => f.id), ...rows.map((r) => r.id)])

  const wanted = only
    ? [{ month: only.month, unused: 0, short: Math.min(only.count, MAX_NEW_PER_MONTH) }]
    : monthsNeedingFacts(library, used, now)
  const result: TopUpResult = { months: [], wrote: 0, library: library.length }

  for (const { month, short } of wanted) {
    const count = Math.min(short, MAX_NEW_PER_MONTH)
    // Everything already said about this month, plus every fact that was
    // dropped — a dropped fact was wrong or unwanted, and writing it a second
    // time is the one mistake this list can prevent outright.
    const avoid = [
      ...library.filter((f) => f.months?.includes(month)).map((f) => f.title),
      ...rows.filter((r) => r.retired_at).map((r) => r.title),
    ]
    const rejected: string[] = []
    const fresh: WrittenFact[] = []
    try {
      for (const raw of await askForFacts(apiKey, model, month, count, avoid)) {
        // Checked against what is already there AND against the ones written a
        // moment ago in this same reply.
        const checked = validateFact(raw, month, [...avoid, ...fresh.map((f) => f.title)], taken)
        if ('reason' in checked) {
          rejected.push(`${String(raw.title ?? '?').slice(0, 60)}: ${checked.reason}`)
          continue
        }
        taken.add(checked.fact.id)
        fresh.push(checked.fact)
      }
      if (fresh.length) {
        const { error } = await sb
          .from('meeting_facts')
          .insert(fresh.map((f) => ({ ...f, source: 'written' })))
        if (error) throw error
      }
    } catch (e) {
      // One month failing must not cost the other, and it must not cost the
      // heartbeat either — a run that fails silently is how this ends up
      // discovered at a meeting.
      rejected.push((e as Error).message)
    }
    result.months.push({ month: MONTH_NAMES[month - 1], asked: count, wrote: fresh.length, rejected })
    result.wrote += fresh.length
  }

  // A month that was asked for and got nothing is a failure, whatever the
  // reason: a refused API key and a reply where every fact was rejected both
  // end with a library that quietly stops filling.
  const empty = result.months.filter((m) => !m.wrote)
  await reportHealth(
    sb,
    !empty.length,
    wanted.length === 0
      ? 'Every month is stocked'
      : empty.length
        ? `Wrote nothing for ${empty.map((m) => m.month).join(', ')}: ${empty[0].rejected[0] ?? 'no reason given'}`
        : `Wrote ${result.wrote} for ${result.months.map((m) => m.month).join(', ')}`,
  )

  return result
}

/**
 * What the job thought of its own run.
 *
 * Written every time rather than only on success, because the failure that
 * actually threatens this is a run that happens on time and writes nothing —
 * which a heartbeat cannot say. The hourly monitor turns a bad verdict into an
 * alert to every manager; see integration-health.mts.
 */
export async function reportHealth(sb: SupabaseClient, ok: boolean, detail: string) {
  const now = new Date().toISOString()
  await sb
    .from('integration_health')
    .update({
      status: ok ? 'ok' : 'error',
      detail,
      last_checked_at: now,
      updated_at: now,
      ...(ok ? { last_success_at: now, data_at: now, consecutive_fail: 0 } : {}),
    })
    .eq('source_key', 'meeting_facts')
}
