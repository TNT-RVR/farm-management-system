import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

// The farm's own numbers: what a calf costs to produce, what another hundred
// pounds is worth, and whether locking in early is the right call this year.
//
// Everything here returns null rather than a figure when an input is missing.
// A break-even with the feed cost silently treated as zero is not a conservative
// estimate — it is a wrong number that looks like a good one.

export type CattleCosts = {
  id: string
  ranch: string
  crop_year: number
  cow_cost_per_head: number | null
  feed_cost_per_head: number | null
  pasture_cost_per_head: number | null
  vet_cost_per_head: number | null
  other_cost_per_head: number | null
  death_loss_pct: number | null
  weaning_rate_pct: number | null
  cost_of_gain_per_lb: number | null
  /** Typed cull cow price, $/cwt: used when no market sold cows in the last two weeks. */
  cull_cow_price_cwt?: number | null
  /** Yardage, $ a head a day: wintering a cow, and backgrounding a calf (the cost-of-gain worksheet starts from it). */
  cow_yardage_per_day?: number | null
  calf_yardage_per_day?: number | null
  notes: string | null
  /**
   * Set when the year asked for has no row of its own and this is the newest
   * earlier year's, carried over. The screen says so, and an edit saves into
   * the year asked for — the earlier year's row is never changed.
   */
  carriedFrom?: number | null
}

const num = (v: number | string | null | undefined): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * A ranch's cost assumptions for a year.
 *
 * Rows are keyed by year, and nobody re-types a cow's cost on New Year's Day —
 * so a year with no row of its own falls back to the most recent earlier one,
 * marked `carriedFrom`. Before this, every break-even went blank on 1 January.
 */
export function useCattleCosts(ranch: string | null, year: number) {
  return useQuery({
    queryKey: ['cattle-costs', ranch, year],
    enabled: Boolean(ranch),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cattle_cost_assumptions')
        .select('*')
        .eq('ranch', ranch!)
        .lte('crop_year', year)
        .order('crop_year', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return {
        ...data,
        carriedFrom: data.crop_year < year ? data.crop_year : null,
        cow_cost_per_head: num(data.cow_cost_per_head),
        feed_cost_per_head: num(data.feed_cost_per_head),
        pasture_cost_per_head: num(data.pasture_cost_per_head),
        vet_cost_per_head: num(data.vet_cost_per_head),
        other_cost_per_head: num(data.other_cost_per_head),
        cow_yardage_per_day: num(data.cow_yardage_per_day),
        calf_yardage_per_day: num(data.calf_yardage_per_day),
        death_loss_pct: num(data.death_loss_pct),
        weaning_rate_pct: num(data.weaning_rate_pct),
        cost_of_gain_per_lb: num(data.cost_of_gain_per_lb),
        cull_cow_price_cwt: num(data.cull_cow_price_cwt),
      } as CattleCosts
    },
  })
}

export function useSaveCattleCosts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      row: Database['public']['Tables']['cattle_cost_assumptions']['Insert'],
    ) => {
      const { error } = await supabase
        .from('cattle_cost_assumptions')
        .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'ranch,crop_year' })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cattle-costs'] }),
  })
}

// ── Break-even ──────────────────────────────────────────────────────────────

export type BreakEven = {
  /** Total cost of carrying one cow for the year. */
  costPerCow: number
  /** Calves actually sold per cow exposed, after weaning and death loss. */
  calvesPerCow: number
  costPerCalf: number
  /** The price a calf must fetch to cover it. */
  perLb: number | null
  /** Which inputs were supplied, so the UI can say what is missing. */
  missing: string[]
}

const COST_FIELDS: [keyof CattleCosts, string][] = [
  ['cow_cost_per_head', 'cow cost'],
  ['feed_cost_per_head', 'feed'],
  ['pasture_cost_per_head', 'pasture'],
  ['vet_cost_per_head', 'vet'],
  ['other_cost_per_head', 'other'],
]

/**
 * What a calf has to fetch to pay for itself.
 *
 * The per-cow costs are divided by the calves actually SOLD per cow, not by the
 * cows: a 92% weaning rate and 2% death loss mean roughly nine calves carry the
 * cost of ten cows, and ignoring that understates the break-even by a tenth.
 *
 * Missing cost lines are listed rather than assumed zero. A break-even that
 * quietly leaves out feed is worse than no break-even, because it reads as good
 * news.
 */
export function breakEven(costs: CattleCosts | null, avgWeightLb: number | null): BreakEven | null {
  if (!costs) return null
  const missing = COST_FIELDS.filter(([k]) => costs[k] == null).map(([, label]) => label)
  const costPerCow = COST_FIELDS.reduce((sum, [k]) => sum + (num(costs[k]) ?? 0), 0)
  if (costPerCow <= 0) return null

  const weaning = (costs.weaning_rate_pct ?? 100) / 100
  const death = (costs.death_loss_pct ?? 0) / 100
  const calvesPerCow = Math.max(0.01, weaning * (1 - death))
  const costPerCalf = costPerCow / calvesPerCow

  return {
    costPerCow,
    calvesPerCow,
    costPerCalf,
    perLb: avgWeightLb && avgWeightLb > 0 ? costPerCalf / avgWeightLb : null,
    missing,
  }
}

// ── Value of gain ───────────────────────────────────────────────────────────

export type ValueOfGain = {
  fromLb: number
  toLb: number
  fromPricePerLb: number
  toPricePerLb: number
  /** Extra money the heavier calf brings in. */
  extraRevenue: number
  /** What those pounds cost to put on, when we know. */
  extraCost: number | null
  marginPerHead: number | null
  /** Revenue per extra pound — the number that decides it. */
  valuePerLb: number
}

/**
 * What another hundred pounds is actually worth.
 *
 * The trap this exists to avoid: a heavier calf sells for a LOWER price per
 * pound, so the extra revenue is never simply "100 lb times today's price". It
 * is the heavier animal's whole cheque minus the lighter one's, and that
 * difference is routinely half what people expect.
 */
export function valueOfGain(
  fromLb: number,
  fromPricePerLb: number,
  toLb: number,
  toPricePerLb: number,
  costOfGainPerLb: number | null,
): ValueOfGain | null {
  if (toLb <= fromLb) return null
  const extraRevenue = toLb * toPricePerLb - fromLb * fromPricePerLb
  const gain = toLb - fromLb
  const extraCost = costOfGainPerLb != null ? gain * costOfGainPerLb : null
  return {
    fromLb,
    toLb,
    fromPricePerLb,
    toPricePerLb,
    extraRevenue,
    extraCost,
    marginPerHead: extraCost != null ? extraRevenue - extraCost : null,
    valuePerLb: extraRevenue / gain,
  }
}

// ── Selling strategies ──────────────────────────────────────────────────────

export type Strategy = {
  name: string
  detail: string
  /** Net per head, or null when an input for it is missing. */
  netPerHead: number | null
  /** What the farm is exposed to if it goes wrong. */
  risk: string
}

/**
 * Sell at weaning, background to a heavier weight, or price forward.
 *
 * Every branch returns null where it lacks an input rather than filling a gap
 * with an average — three options where one is quietly guessed is not a
 * comparison, it is a recommendation in disguise.
 */
export function compareStrategies(input: {
  weanLb: number | null
  weanPricePerLb: number | null
  backgroundToLb: number | null
  backgroundPricePerLb: number | null
  costOfGainPerLb: number | null
  forwardPricePerLb: number | null
}): Strategy[] {
  const { weanLb, weanPricePerLb, backgroundToLb, backgroundPricePerLb, costOfGainPerLb, forwardPricePerLb } = input
  const atWeaning = weanLb != null && weanPricePerLb != null ? weanLb * weanPricePerLb : null

  const vog =
    weanLb != null && weanPricePerLb != null && backgroundToLb != null && backgroundPricePerLb != null
      ? valueOfGain(weanLb, weanPricePerLb, backgroundToLb, backgroundPricePerLb, costOfGainPerLb)
      : null

  return [
    {
      name: 'Sell at weaning',
      detail:
        weanLb != null && weanPricePerLb != null
          ? `${weanLb} lb at $${weanPricePerLb.toFixed(2)}/lb`
          : 'needs a weaning weight and today’s price',
      netPerHead: atWeaning,
      risk: 'None left — the cheque is written. You take whatever the market is that week.',
    },
    {
      name: `Background to ${backgroundToLb ?? '—'} lb`,
      detail:
        vog != null
          ? `+${vog.toLb - vog.fromLb} lb worth $${vog.valuePerLb.toFixed(2)}/lb of gain`
          : 'needs a target weight and a price for it',
      netPerHead:
        atWeaning != null && vog?.marginPerHead != null ? atWeaning + vog.marginPerHead : null,
      risk: 'Feed cost and the market both move against you while you hold. Weight is the only certainty.',
    },
    {
      name: 'Price forward',
      detail:
        forwardPricePerLb != null && weanLb != null
          ? `${weanLb} lb at $${forwardPricePerLb.toFixed(2)}/lb, delivered later`
          : 'needs a forward bid',
      netPerHead:
        forwardPricePerLb != null && weanLb != null ? weanLb * forwardPricePerLb : null,
      risk: 'Price is fixed, so a rally goes to the buyer. You still carry the weight and the death loss until delivery.',
    },
  ]
}

// ── The lock-in scorecard ───────────────────────────────────────────────────

export type LockInSignal = {
  label: string
  reading: string
  /** Toward locking in, toward waiting, or neither. */
  lean: 'lock' | 'wait' | 'neutral'
  why: string
}

/**
 * The inputs behind a lock-in decision, each with its own reading.
 *
 * Deliberately NOT a single score or a recommendation. The app can tell you
 * where the price sits against ten years and which way basis is leaning; it
 * cannot know whether this farm needs the cash in November, what the banker
 * said, or how much risk the family wants to carry. Presenting four honest
 * readings beats one confident number that hides all of that.
 */
export function lockInSignals(input: {
  forwardPricePerLb: number | null
  historyPricesPerLb: number[]
  basis: number | null
  basisHistory: number[]
  curveSlope: number | null
  breakEvenPerLb: number | null
}): LockInSignal[] {
  const signals: LockInSignal[] = []
  const { forwardPricePerLb, historyPricesPerLb, basis, basisHistory, curveSlope, breakEvenPerLb } = input

  if (forwardPricePerLb != null && historyPricesPerLb.length >= 5) {
    const below = historyPricesPerLb.filter((h) => h <= forwardPricePerLb).length
    const pct = Math.round((below / historyPricesPerLb.length) * 100)
    signals.push({
      label: 'Against our own history',
      reading: `${pct}th percentile of ${historyPricesPerLb.length} years`,
      lean: pct >= 70 ? 'lock' : pct <= 30 ? 'wait' : 'neutral',
      why: 'Where this bid sits against every price this farm has actually taken.',
    })
  }

  if (basis != null && basisHistory.length >= 8) {
    const below = basisHistory.filter((h) => h <= basis).length
    const pct = Math.round((below / basisHistory.length) * 100)
    signals.push({
      label: 'Basis',
      reading: `${pct}th percentile`,
      lean: pct >= 70 ? 'lock' : pct <= 30 ? 'wait' : 'neutral',
      why: 'A narrow basis means the local market is paying up against the board.',
    })
  }

  if (curveSlope != null) {
    signals.push({
      label: 'Forward curve',
      reading: `${curveSlope >= 0 ? '+' : ''}${curveSlope.toFixed(2)} across the months`,
      lean: curveSlope > 0 ? 'wait' : curveSlope < 0 ? 'lock' : 'neutral',
      why: 'A curve sloping up pays you to deliver later; sloping down, it wants them now.',
    })
  }

  if (breakEvenPerLb != null && forwardPricePerLb != null) {
    const over = forwardPricePerLb - breakEvenPerLb
    signals.push({
      label: 'Against break-even',
      reading: `${over >= 0 ? '+' : '−'}$${Math.abs(over).toFixed(2)}/lb`,
      lean: over > 0 ? 'lock' : 'wait',
      why: 'A bid that already clears the cost of production is a different decision from one that does not.',
    })
  }

  return signals
}

// ── A starting point ────────────────────────────────────────────────────────

export type BenchmarkLine = {
  key: string
  label: string
  base: number
  factor: number | null
  current: number
  escalated: boolean
}

export type CostBenchmark = {
  key: string
  base_year: number
  source: string
  index_as_of: string | null
  lines: BenchmarkLine[]
  total_per_cow: number | null
  refreshed_at: string
}

/**
 * The published benchmark, kept current by the quarterly refresh.
 *
 * Null when it has never been fetched — the UI falls back to the figures
 * compiled in, and says which it is showing.
 */
export function useCostBenchmark() {
  return useQuery({
    queryKey: ['cost-benchmark', 'cattle_cow_calf_ab'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cost_benchmarks')
        .select('*')
        .eq('key', 'cattle_cow_calf_ab')
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return {
        ...data,
        lines: (data.lines ?? []) as unknown as BenchmarkLine[],
        total_per_cow: num(data.total_per_cow as number | string | null),
      } as CostBenchmark
    },
    staleTime: 60 * 60_000,
  })
}


/**
 * Benchmark cow-calf costs, per cow per year.
 *
 * Taken from Manitoba Agriculture's "2026 Cost of Production, Beef Cow-Calf,
 * 150 Cow Herd — Hay Ration", dated September 2025. That is the most recent
 * published PRAIRIE budget I could get the actual line items out of: Alberta's
 * own AgriProfit$ cow-calf benchmark is the better comparison in principle, but
 * the published report is the 2016-20 edition and those numbers are older than
 * the feed market they would be used against.
 *
 * So this is a neighbouring province's budget, not Prairie Creek's, and not
 * Alberta's. It is offered as a filled-in first draft to correct rather than a
 * figure to rely on — pasture and feed in particular differ a good deal between
 * southern Alberta irrigation country and a Manitoba hay ration.
 *
 * The mapping onto our five lines, from that budget's own tables:
 *   cow      herd replacement 267.60 + breeding 46.60 + cow amortisation
 *            107.14 + operating interest 42.74
 *   feed     grain 27.12 + forages 426.12 + salt/minerals 47.09 + extended
 *            grazing 41.53 + straw 70.00
 *   pasture  rental 59.38 + operating 34.77 + fencing depreciation 9.38 +
 *            fencing amortisation 34.25
 *   vet      veterinary medicine and supplies 33.88
 *   other    owner labour 224.00 + fuel/maintenance 47.87 + utilities 11.69 +
 *            marketing and transport 41.83 + insurance 30.77 + miscellaneous
 *            6.67 + manure 10.84 + machinery depreciation 116.00 + machinery
 *            amortisation 41.43 + buildings 32.86
 *
 * The budget's own "Death Loss $62.50" line is deliberately NOT included: this
 * app models death loss as a percentage that reduces the calves sold, and
 * carrying it in both places would charge for it twice.
 */
export const COW_CALF_BENCHMARK_COSTS = {
  cow_cost_per_head: 464,
  feed_cost_per_head: 612,
  pasture_cost_per_head: 138,
  vet_cost_per_head: 34,
  other_cost_per_head: 563,
  // Common Prairie planning assumptions, and the ones that budget is built on.
  weaning_rate_pct: 92,
  death_loss_pct: 2,
  // Backgrounding cost of gain, southern Alberta, barley ration.
  cost_of_gain_per_lb: 1.4,
} as const

/** Says Manitoba in so many words: the figure is easy to mistake for Alberta's. */
export const COW_CALF_BENCHMARK_SOURCE =
  'Manitoba 2026 Cost of Production, Beef Cow-Calf — 150 cow herd, hay ration (Manitoba Agriculture, September 2025) — not an Alberta figure'

/** Total per cow in the benchmark, for the "is mine sane?" comparison. */
export const benchmarkTotalPerCow =
  COW_CALF_BENCHMARK_COSTS.cow_cost_per_head +
  COW_CALF_BENCHMARK_COSTS.feed_cost_per_head +
  COW_CALF_BENCHMARK_COSTS.pasture_cost_per_head +
  COW_CALF_BENCHMARK_COSTS.vet_cost_per_head +
  COW_CALF_BENCHMARK_COSTS.other_cost_per_head

/**
 * The pasture rental inside the benchmark's pasture line ($59.38 of $138).
 *
 * Sam (1 Oct 2026): "We dont pay rent on pasture land." The published budget
 * stays as published — it is a Manitoba figure and says so — but every place
 * the app offers it as OUR starting figure takes the rent out, so a cow is not
 * charged for grass the farm already owns. What is left of the line is the
 * operating and fencing cost, which the farm does pay.
 */
export const BENCHMARK_PASTURE_RENT = 59.38

/** A benchmark pasture line with the rent taken out, never below zero. */
export const ownGrass = (pasturePerCow: number) => Math.max(0, Math.round(pasturePerCow - BENCHMARK_PASTURE_RENT))

/** The benchmark total for a farm that owns its grass. */
export const ownGrassBenchmarkTotalPerCow =
  benchmarkTotalPerCow - COW_CALF_BENCHMARK_COSTS.pasture_cost_per_head + ownGrass(COW_CALF_BENCHMARK_COSTS.pasture_cost_per_head)
