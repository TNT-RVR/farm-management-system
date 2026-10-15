import type { SupabaseClient } from '@supabase/supabase-js'

// Keeping the cattle cost benchmark current, on its own.
//
// ── Which base, and why not Alberta's ───────────────────────────────────────
//
// Alberta publishes the better KIND of benchmark: AgriProfit$ is built from
// actual farm records rather than a modelled budget. But its newest edition
// covers 2018-2022, and a four-year-old feed cost is not something to price
// calves against — feed alone has moved a quarter since, in both directions.
//
// So the base is the most recent PUBLISHED cow-calf budget instead: MANITOBA
// Agriculture's 2026 Cost of Production, Beef Cow-Calf (150 cow herd, hay
// ration), dated September 2025. It is a modelled budget rather than survey
// data, and it is Manitoba's, not Alberta's — but it is current, which the
// Alberta edition is not, and current beats local when the gap is four years of
// feed inflation. Every label that reaches a screen says Manitoba outright; the
// stored row's key ('cattle_cow_calf_ab') is a historical name, not a claim.
//
// ── Keeping it current ──────────────────────────────────────────────────────
//
// Each line is carried forward on the CANADA column of StatCan's Farm Input
// Price Index (table 18-10-0258), quarterly. The budget is dated to the 2026
// production year, so escalation runs from 2026 forward: today that is a factor
// of 1.0 and the figures are the budget as published, and it drifts on its own
// as quarters land. Nobody has to remember to update it.
//
// StatCan suppresses the veterinary and animal-wage series at every geography,
// national included, so those lines are carried at base and marked as such
// rather than moved on an index that is really measuring something else.
//
// ── Two traps found the hard way ────────────────────────────────────────────
//
// StatCan does NOT return replies in request order, so every reply is matched by
// its own coordinate rather than by position. Reading them positionally is how a
// first pass at this had the feed and machinery series swapped — and it looked
// entirely plausible, because both are numbers around 150.
//
// And an index can be REBASED, which would make a ratio across the break
// meaningless. Every series is checked for a jump before it is trusted; one that
// looks rebased is dropped and its line stays at base rather than being moved by
// a number that is really a change of units.

const WDS = 'https://www150.statcan.gc.ca/t1/wds/rest'
const FIPI = 18100258
/** Canada is the first geography member of the farm input price cube. */
const CANADA = 1
/** The production year the source budget is written for. */
export const BASE_YEAR = 2026

/**
 * The Manitoba 2026 cow-calf budget, per cow, mapped onto our five lines:
 *
 *   cow      herd replacement 267.60 + breeding 46.60 + cow amortisation
 *            107.14 + operating interest 42.74
 *   feed     grain 27.12 + forages 426.12 + salt/minerals 47.09 + extended
 *            grazing 41.53 + straw 70.00
 *   pasture  rental 59.38 + operating 34.77 + fencing 43.63
 *   vet      veterinary medicine and supplies 33.88
 *   other    owner labour 224.00 + fuel and maintenance 47.87 + utilities 11.69
 *            + marketing 41.83 + insurance 30.77 + miscellaneous 6.67 + manure
 *            10.84 + machinery 157.43 + buildings 32.86
 *
 * The budget's own $62.50 death-loss line is deliberately excluded: this app
 * models death loss as a percentage that reduces the calves sold, and carrying
 * it in both places would charge for it twice.
 *
 * `index` is the price-index member that carries the line forward. Pasture and
 * the cow line have no clean counterpart, so they sit at base and are flagged —
 * moving them on an unrelated index would be a guess wearing a statistic's
 * clothes.
 */
export const COW_CALF_BENCHMARK_BASE: {
  key: string
  label: string
  perCow: number
  index: number | null
}[] = [
  { key: 'cow_cost_per_head', label: 'Cow cost', perCow: 464, index: null },
  { key: 'feed_cost_per_head', label: 'Winter feed', perCow: 612, index: 26 },
  { key: 'pasture_cost_per_head', label: 'Pasture', perCow: 138, index: null },
  { key: 'vet_cost_per_head', label: 'Vet and medicine', perCow: 34, index: 29 },
  { key: 'other_cost_per_head', label: 'Everything else', perCow: 563, index: 3 },
]

/**
 * Written into cost_benchmarks.source on every refresh, so the stored row
 * picks up a wording change at the next quarterly run with no migration.
 */
export const COW_CALF_BENCHMARK_SOURCE =
  'Manitoba 2026 Cost of Production, Beef Cow-Calf — 150 cow herd, hay ration (Manitoba Agriculture, September 2025), carried forward on Statistics Canada’s national farm input price index — not an Alberta figure'

type Point = { refPer: string; value: number | null }

/**
 * Whether a series looks continuous enough to take a ratio across.
 *
 * A rebase shows up as one quarter moving further than any real input price
 * does. Anything over 25% in a single quarter is treated as a change of units
 * rather than a change of price.
 */
export function looksContinuous(points: Point[]): boolean {
  const vals = points.filter((p) => typeof p.value === 'number').map((p) => p.value as number)
  if (vals.length < 8) return false
  for (let i = 1; i < vals.length; i++) {
    if (vals[i - 1] > 0 && Math.abs(vals[i] / vals[i - 1] - 1) > 0.25) return false
  }
  return true
}

/** The escalation factor from a base year's average to the newest quarter. */
export function escalation(points: Point[], baseYear: number): number | null {
  if (!looksContinuous(points)) return null
  const base = points.filter((p) => p.refPer.startsWith(String(baseYear)) && p.value != null)
  const latest = [...points].reverse().find((p) => p.value != null)
  if (base.length === 0 || !latest?.value) return null
  const mean = base.reduce((s, p) => s + (p.value as number), 0) / base.length
  if (mean <= 0) return null
  const factor = latest.value / mean
  // A factor outside this range is not inflation, it is a mistake.
  return factor > 0.3 && factor < 5 ? factor : null
}

/** Fetch the index series. Matched by coordinate, never by position. */
async function fetchIndex(members: number[]): Promise<Map<number, Point[]>> {
  const body = members.map((m) => ({
    productId: FIPI,
    coordinate: `${CANADA}.${m}.0.0.0.0.0.0.0.0`,
    latestN: 30,
  }))
  const res = await fetch(`${WDS}/getDataFromCubePidCoordAndLatestNPeriods`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`StatCan FIPI failed (${res.status})`)
  const replies = (await res.json()) as {
    object?: { coordinate?: string; vectorDataPoint?: Point[] }
  }[]

  const out = new Map<number, Point[]>()
  for (const r of replies) {
    const coord = r.object?.coordinate
    if (!coord) continue
    // "1.26.0.0..." — the second part is the index member. Read it back rather
    // than assuming this reply is the one we asked for in this slot.
    const member = Number(coord.split('.')[1])
    if (Number.isFinite(member)) out.set(member, r.object?.vectorDataPoint ?? [])
  }
  return out
}

export type BenchmarkLine = {
  key: string
  label: string
  base: number
  factor: number | null
  current: number
  /** Null factor means this line is carried at base, and the UI says why. */
  escalated: boolean
}

export async function computeBenchmark(): Promise<{
  lines: BenchmarkLine[]
  asOf: string | null
  total: number
}> {
  const members = COW_CALF_BENCHMARK_BASE.map((l) => l.index).filter((m): m is number => m != null)
  const series = await fetchIndex(members)

  let asOf: string | null = null
  const lines = COW_CALF_BENCHMARK_BASE.map((l) => {
    const pts = l.index != null ? (series.get(l.index) ?? []) : []
    const factor = l.index != null ? escalation(pts, BASE_YEAR) : null
    const latest = [...pts].reverse().find((p) => p.value != null)
    if (latest && (!asOf || latest.refPer > asOf)) asOf = latest.refPer
    return {
      key: l.key,
      label: l.label,
      base: l.perCow,
      factor,
      current: Math.round(l.perCow * (factor ?? 1)),
      escalated: factor != null,
    }
  })
  return { lines, asOf, total: lines.reduce((s, l) => s + l.current, 0) }
}

/** Refresh the stored benchmark. Runs quarterly; the index only moves that often. */
export async function runBenchmarkRefresh(
  sb: SupabaseClient,
): Promise<{ ok: boolean; total: number; detail: string }> {
  try {
    const { lines, asOf, total } = await computeBenchmark()
    const escalated = lines.filter((l) => l.escalated).length
    const { error } = await sb.from('cost_benchmarks').upsert(
      {
        key: 'cattle_cow_calf_ab',
        base_year: BASE_YEAR,
        source: COW_CALF_BENCHMARK_SOURCE,
        index_as_of: asOf,
        lines,
        total_per_cow: total,
        refreshed_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    )
    if (error) throw new Error(error.message)
    return {
      ok: true,
      total,
      detail: `Manitoba ${BASE_YEAR} cow-calf base carried to ${asOf ?? 'unknown'}: $${total}/cow, ${escalated}/${lines.length} lines escalated`,
    }
  } catch (e) {
    return { ok: false, total: 0, detail: (e as Error).message }
  }
}
