/**
 * Lifting the usable figures out of the papers we can read.
 *
 * The valuable part of an agronomy paper is usually one number: the threshold
 * you spray at, the rate, the stage, the interval. Full-text search finds it
 * only if you already know it is there, so each figure is pulled out on its own
 * into research_numbers, where a page can show it and prove it in the same
 * breath.
 *
 * Three things keep it honest, because a wrong threshold is worse than none:
 *
 *  1. Only passages worth reading are sent. A passage qualifies if its paper is
 *     strongly about one of our subjects (research_paper_about.about >= 3) and
 *     the text carries a unit a farm would act on. Without that second test
 *     "threshold" matches the noise floor of a mass spectrometer and "rate"
 *     matches a chromatography gradient — both of which are in this library.
 *  2. The model may only tag a figure with a crop or active that this paper's
 *     own folders already name. It picks from a list rather than spelling.
 *  3. Every figure must quote a passage that really occurs in the text. A quote
 *     that does not match is dropped and counted. That is the whole defence
 *     against an invented number, so the comparison is strict: spacing, dashes
 *     and quote marks are levelled, letters and digits are not.
 *
 * Everything lands 'unreviewed'; the app reads only confirmed rows.
 *
 * This runs in a background function rather than a local script because the
 * Anthropic key lives in the server's environment, and because 800-odd
 * passages take well over the fifteen minutes one invocation gets. A run works
 * to a budget and stops; pressing the button again carries on where it left
 * off, because every passage read is written to research_passages_read —
 * including the majority that hold no figure at all.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { callClaude } from './anthropic.ts'
// The part that decides whether a reading may be stored lives in src/lib, where
// the test suite reaches it. vitest covers src/** only, and this is the one
// piece here that must be provable rather than merely careful.
import { checkFigure, cropsNamedIn, flatten, MEASURES, UNITS_SQL } from '../../src/lib/research-numbers.ts'

export { MEASURES, UNITS_SQL }

export type NumbersResult = {
  read: number
  kept: number
  dropped: number
  failed: number
  remaining: number
  /** Why figures were dropped, commonest first — the honesty check. */
  why: Record<string, number>
  detail: string
}

type Paper = {
  title: string | null
  year: number | null
  region: string | null
  relevance: number | null
}

type Chunk = {
  id: number
  paper_id: string
  page_from: number | null
  text: string
  title?: string | null
  year?: number | null
  region?: string
  relevance?: number
}

/**
 * Every row of a query, not the first thousand.
 *
 * PostgREST answers a plain select with at most 1,000 rows and says nothing
 * about the rest. That silently halved this pass's candidate list on the first
 * run — 347 passages where the database held 838 — and it has broken two other
 * scripts in this repo the same way, so every unbounded read here pages.
 */
async function allRows<T>(make: () => { range: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> }): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

const system = `You read agronomy papers and lift out the figures a farm would act on.

Return ONLY a JSON array, no prose around it. One object per figure:

{"measure": one of ${MEASURES.map((m) => `"${m}"`).join(', ')},
 "subject": what the figure is about, in the paper's own words (a crop, a pest, a disease, a product),
 "crop": one of the crops offered, or null,
 "active": one of the actives offered, or null,
 "low": the number, or the bottom of a range,
 "high": the top of a range, or the same as low for a single figure,
 "unit": the unit as written ("kg/ha", "larvae/plant", "%", "days", "C"), or null,
 "qualifier": the condition it holds under ("per sweep", "at 10% bloom", "coarse soil"), or null,
 "passage": the sentence from the text that states it, copied EXACTLY, 30 to 300 characters,
 "confidence": 3 if the text states this plainly as a recommendation or finding, 2 if it is clear but needs reading, 1 if you are unsure}

Rules, in order of importance:

1. Copy "passage" character for character from the text given. Never tidy it, never join two sentences, never write one yourself. A quote that does not appear in the text is thrown away.

2. Only a figure a farmer could act on next season: advice, a recommendation, or a finding the paper itself generalises into one. THE COMMONEST MISTAKE IS TAKING THE TRIAL'S OWN METHOD FOR ADVICE. Return [] for all of these, however plainly they are stated:
   - the dose, rate or volume the researchers applied to their own plots, including one the paper calls a "recommended field rate" while describing what it sprayed on its treatments
   - a figure describing how the experiment was run: plot size, replicate count, p-value, instrument setting, sample mass, nozzle or sprayer settings, when treatments were imposed
   - a bare result ("only 13% control at the highest rate of 16 kg ai/ha") with no recommendation drawn from it
   - a figure about equipment or another industry's crop — orchard, vineyard, greenhouse, drone or tractor-sprayer engineering — rather than about growing the crop
   - a figure quoted from a different paper, or from a sentence the paper calls not significant
   - a measurement taken on the trial's own plants rather than something a farm sees: shoot dry weight, tissue nitrogen, nutrient availability in a pot, a cultivar's seed yield in a variety trial
   - "yield response" is the easiest measure to over-use. Use it only where the paper ties a yield to something a farm chooses — a rate, a water amount, a variety decision — and not for every yield it happens to report

3. One row per distinct figure. If the same number appears twice in the passage, or you could describe it two ways, return it once. Make "subject" the short name of the thing itself ("flea beetle", "nitrogen", "glyphosate"), not a sentence about the experiment.

4. "crop" and "active" may only be a name from the lists offered. If the figure is about something else, use null and still fill "subject". Do not attach a crop because the list contains something vaguely like it.

5. A range stays a range. Do not average it.

6. If the passage contains no such figure, return [].

Most passages in a research paper contain nothing that belongs here. Returning [] is the normal, correct answer; stretching to find something is the failure.`

async function readPassage(
  chunk: Chunk,
  crops: string[],
  actives: string[],
  apiKey: string,
  model: string,
): Promise<unknown[]> {
  const res = await callClaude(
    {
      model,
      maxTokens: 2000,
      thinking: { type: 'disabled' },
      system,
      messages: [{
        role: 'user',
        content: `Paper: ${chunk.title ?? 'untitled'}${chunk.year ? ` (${chunk.year})` : ''}
Crops offered: ${crops.length ? crops.join(', ') : 'none'}
Actives offered: ${actives.length ? actives.join(', ') : 'none'}

Text:
"""
${chunk.text}
"""`,
      }],
    },
    { apiKey, signal: AbortSignal.timeout(90_000) },
  )
  if (!res.ok) throw new Error(`model ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const reply = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = (reply.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end < start) return []
  try {
    const rows = JSON.parse(text.slice(start, end + 1))
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

/** Which crops and actives each paper's own folders already name. */
async function vocabulary(sb: SupabaseClient, paperIds: string[]) {
  const byPaper = new Map<string, { crops: Set<string>; actives: Set<string> }>()
  for (let i = 0; i < paperIds.length; i += 120) {
    const slice = paperIds.slice(i, i + 120)
    const rows = await allRows<{ paper_id: string; research_folders: { crop_names: string[] | null; actives: string[] | null } | null }>(
      () => sb.from('research_paper_folders')
        .select('paper_id, research_folders!inner(crop_names, actives)')
        .in('paper_id', slice)
        .order('paper_id') as never,
    )
    for (const r of rows) {
      const seen = byPaper.get(r.paper_id) ?? { crops: new Set<string>(), actives: new Set<string>() }
      for (const c of r.research_folders?.crop_names ?? []) seen.crops.add(c)
      for (const a of r.research_folders?.actives ?? []) seen.actives.add(a)
      byPaper.set(r.paper_id, seen)
    }
  }
  return byPaper
}

/**
 * Nearest to our fields first, as everywhere else in the library.
 *
 * This is not cosmetic. A run has a budget, so whatever sorts first is what
 * actually gets read, and the first pass without this ordering spent its whole
 * batch on drone spraying in vineyards, pear orchards and a ryegrass
 * resistance-genetics screen — every quote real, every figure useless here.
 * Alberta extension work is where a recommendation a farm can act on is
 * actually written down, so it goes first.
 */
const REGION_RANK: Record<string, number> = {
  southern_alberta: 0,
  alberta: 1,
  prairies: 2,
  canada: 3,
  northern_plains: 4,
  other: 5,
}

/**
 * The two ways one figure can arrive twice: the same number again, and the
 * same sentence again under a different measure.
 */
function figureKeys(r: {
  paper_id: string
  measure: string
  value_low: number | string | null
  value_high: number | string | null
  unit: string | null
  passage: string
}): string[] {
  const n = (v: number | string | null) => (v === null ? '' : String(Number(v)))
  return [
    `${r.paper_id}|${r.measure}|${n(r.value_low)}|${n(r.value_high)}|${r.unit ?? ''}`,
    `${r.paper_id}|${flatten(r.passage).slice(0, 200)}|${n(r.value_low)}|${n(r.value_high)}`,
  ]
}

/** Passages worth reading that have not been read yet, nearest work first. */
export async function candidatePassages(sb: SupabaseClient, opts: { redo?: boolean; paperId?: string } = {}) {
  const fields = 'id, paper_id, page_from, text, research_papers!inner(title, year, region, relevance)'
  // The ledger, not research_numbers. Most passages correctly hold no figure,
  // so "has a row in research_numbers" would mark only the fruitful ones read
  // and every run would start over on the same empty ones.
  const done = opts.redo
    ? new Set<number>()
    : new Set(
        (await allRows<{ chunk_id: number }>(() =>
          sb.from('research_passages_read').select('chunk_id').order('chunk_id') as never))
          .map((r) => r.chunk_id),
      )

  const name = (rows: (Chunk & { research_papers?: Paper | null })[]) =>
    rows
      .filter((c) => !done.has(c.id))
      .map((c) => ({
        ...c,
        title: c.research_papers?.title ?? null,
        year: c.research_papers?.year ?? null,
        region: c.research_papers?.region ?? 'other',
        relevance: c.research_papers?.relevance ?? 0,
      }))
      .sort(
        (a, b) =>
          (REGION_RANK[a.region] ?? 9) - (REGION_RANK[b.region] ?? 9) ||
          b.relevance - a.relevance ||
          a.paper_id.localeCompare(b.paper_id) ||
          a.id - b.id,
      )

  if (opts.paperId) {
    // A named paper is read right through: the unit test is what picks papers
    // out of three thousand, not what decides a passage is worth reading.
    return name(await allRows(() =>
      sb.from('research_paper_chunks').select(fields).eq('paper_id', opts.paperId).order('id') as never))
  }

  const about = await allRows<{ paper_id: string }>(() =>
    sb.from('research_paper_about').select('paper_id').gte('about', 3).order('paper_id') as never)
  const ids = [...new Set(about.map((r) => r.paper_id))]
  if (!ids.length) return []

  const out: (Chunk & { research_papers?: Paper | null })[] = []
  for (let i = 0; i < ids.length; i += 120) {
    const slice = ids.slice(i, i + 120)
    out.push(...(await allRows(() =>
      sb.from('research_paper_chunks').select(fields).in('paper_id', slice)
        .filter('text', 'imatch', UNITS_SQL).order('id') as never)))
  }
  return name(out)
}

/** Read passages until the budget runs out. Safe to call again. */
export async function runNumbersPass(
  sb: SupabaseClient,
  apiKey: string,
  model: string,
  opts: { budgetMs?: number; limit?: number; redo?: boolean; paperId?: string; atOnce?: number } = {},
): Promise<NumbersResult> {
  const budgetMs = opts.budgetMs ?? 270_000
  const until = Date.now() + budgetMs
  // Six at a time. There are eight hundred passages to get through and each
  // one is a small, cheap call; three left the budget mostly spent waiting.
  const atOnce = Math.max(1, Math.min(6, opts.atOnce ?? 6))

  const all = await candidatePassages(sb, opts)
  const queue = typeof opts.limit === 'number' ? all.slice(0, opts.limit) : [...all]
  const total = queue.length
  if (!total) {
    return { read: 0, kept: 0, dropped: 0, failed: 0, remaining: 0, why: {}, detail: 'nothing left to read' }
  }

  const papers = [...new Set(queue.map((c) => c.paper_id))]
  const vocab = await vocabulary(sb, papers)
  // Figures already held for these papers, so a run does not pile up another
  // copy. Passages overlap, so one sentence is read in two neighbouring
  // chunks: "A 5 ton/ac crop requires approximately 50 lb/ac of P2O5" came
  // back twice, once as "phosphorus" and once as "phosphorus requirement of
  // alfalfa", which the per-chunk check could not see. Both keys are needed —
  // one catches the same number twice, the other the same sentence filed under
  // two different measures.
  const seen = new Set<string>()
  for (let i = 0; i < papers.length; i += 120) {
    for (const r of await allRows<{ paper_id: string; measure: string; value_low: number | null; value_high: number | null; unit: string | null; passage: string }>(
      () => sb.from('research_numbers')
        .select('paper_id, measure, value_low, value_high, unit, passage')
        .in('paper_id', papers.slice(i, i + 120))
        .order('paper_id') as never,
    )) {
      for (const k of figureKeys(r)) seen.add(k)
    }
  }
  // Our own crop list, offered wherever a passage names one. The folders only
  // carry crop names on the crop folders, so a pea figure out of a fertility
  // sheet had no crop to be tagged with.
  const farmCrops = (await allRows<{ name: string }>(() =>
    sb.from('crops').select('name').order('name') as never)).map((r) => r.name)
  let read = 0
  let kept = 0
  let dropped = 0
  let failed = 0
  const why: Record<string, number> = {}

  const worker = async () => {
    for (;;) {
      if (Date.now() > until) return
      const chunk = queue.shift()
      if (!chunk) return
      const v = vocab.get(chunk.paper_id) ?? { crops: new Set<string>(), actives: new Set<string>() }
      const crops = [...new Set([...v.crops, ...cropsNamedIn(chunk.text, farmCrops)])]
      const actives = [...v.actives]
      let rows: unknown[]
      try {
        rows = await readPassage(chunk, crops, actives, apiKey, model)
      } catch (err) {
        failed += 1
        console.warn(`[numbers] p${chunk.page_from ?? '?'} ${(chunk.title ?? '').slice(0, 50)}: ${(err as Error).message}`)
        continue
      }
      read += 1
      const haystack = flatten(chunk.text)
      const good: Record<string, unknown>[] = []
      for (const r of rows) {
        const out = checkFigure(r, chunk, crops, actives, haystack, model)
        if (out.bad) {
          dropped += 1
          why[out.bad] = (why[out.bad] ?? 0) + 1
          continue
        }
        // The same figure, described two ways, is still one figure. The model
        // returned "pinoxaden" and "pinoxaden field rate used in the
        // co-segregation experiment" as separate readings of one number, and
        // the subject is the part most open to paraphrase — so sameness is
        // judged on the number, its unit and the sentence, not on the words
        // around them. Across the whole paper, because passages overlap and
        // the same sentence is read in two neighbouring chunks.
        const keys = figureKeys(out.row)
        if (keys.some((k) => seen.has(k))) {
          dropped += 1
          why['the same figure twice'] = (why['the same figure twice'] ?? 0) + 1
          continue
        }
        for (const k of keys) seen.add(k)
        good.push(out.row)
      }
      // Mark it read before storing, so a failure to store still counts as
      // read rather than leaving the passage to be paid for again.
      const { error: ledger } = await sb.from('research_passages_read').upsert(
        { chunk_id: chunk.id, paper_id: chunk.paper_id, found: good.length, model },
        { onConflict: 'chunk_id' },
      )
      if (ledger) console.warn(`[numbers] could not mark chunk ${chunk.id} read: ${ledger.message}`)
      if (good.length) {
        // The unique index is on coalesce() expressions, which upsert cannot
        // name, so a repeat is refused by the index rather than merged.
        const { error } = await sb.from('research_numbers').insert(good)
        if (error && !/duplicate key/.test(error.message)) {
          console.warn(`[numbers] could not store ${good.length} from p${chunk.page_from}: ${error.message}`)
        } else if (!error) {
          kept += good.length
        }
      }
    }
  }

  await Promise.all(Array.from({ length: atOnce }, worker))

  const detail = `read ${read} of ${total} passage(s), kept ${kept} figure(s), dropped ${dropped}` +
    (failed ? `, ${failed} failed` : '') +
    (queue.length ? `, ${queue.length} left for the next run` : ', none left')
  return { read, kept, dropped, failed, remaining: queue.length, why, detail }
}
