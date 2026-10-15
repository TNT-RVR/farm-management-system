import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

// The cattle side of the market tab: what the calves actually sold for, what the
// market was doing at the time, and whether locking in early paid.

export type CattleSale = {
  id: string
  ranch: string
  crop_year: number
  animal_class: 'heifers' | 'bulls' | 'steers' | 'runts'
  head: number | null
  sale_date: string | null
  delivery_date: string | null
  avg_weight_lb: number | null
  total_lb: number | null
  price_per_lb: number | null
  total_price: number | null
  buyer: string | null
  notes: string | null
}

const num = (v: number | string | null | undefined): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export function useCattleSales() {
  return useQuery({
    queryKey: ['cattle-sales'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cattle_sales')
        .select('*')
        .order('crop_year', { ascending: false })
      if (error) throw error
      return (data ?? []).map((r) => ({
        ...r,
        avg_weight_lb: num(r.avg_weight_lb),
        total_lb: num(r.total_lb),
        price_per_lb: num(r.price_per_lb),
        total_price: num(r.total_price),
      })) as CattleSale[]
    },
  })
}

export function useSaveCattleSale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      row: Database['public']['Tables']['cattle_sales']['Insert'] & { id?: string },
    ) => {
      const { id, ...rest } = row
      const { error } = id
        ? await supabase
            .from('cattle_sales')
            .update({ ...rest, updated_at: new Date().toISOString() })
            .eq('id', id)
        : await supabase.from('cattle_sales').insert(rest)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cattle-sales'] }),
  })
}

export function useDeleteCattleSale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cattle_sales').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cattle-sales'] }),
  })
}

// ── Shaping ─────────────────────────────────────────────────────────────────

/** Beyond this, a sale was priced forward rather than sold off the truck. */
export const FORWARD_DAYS = 14

export function daysAhead(sale: CattleSale): number | null {
  if (!sale.sale_date || !sale.delivery_date) return null
  const d =
    (new Date(sale.delivery_date).getTime() - new Date(sale.sale_date).getTime()) / 86_400_000
  return Number.isFinite(d) && d >= 0 ? Math.round(d) : null
}

export const wasForward = (s: CattleSale) => (daysAhead(s) ?? 0) > FORWARD_DAYS

/**
 * The weighted average price for a year, across classes.
 *
 * Weighted by pounds, not by lot: a 40-head runt lot and a 117-head bull lot are
 * not two equal opinions about what the calves fetched.
 */
export function yearAverage(sales: CattleSale[]): number | null {
  let lb = 0
  let dollars = 0
  for (const s of sales) {
    if (s.price_per_lb == null) continue
    const weight =
      s.total_lb ?? (s.head != null && s.avg_weight_lb != null ? s.head * s.avg_weight_lb : null)
    if (!weight) continue
    lb += weight
    dollars += weight * s.price_per_lb
  }
  return lb > 0 ? dollars / lb : null
}

/**
 * The classes sold, newest-selling first.
 *
 * Read off the records rather than hard-coded: "runts" appeared once in 2024
 * and a fixed list would have dropped that sale off the chart with no sign it
 * had ever been there.
 */
export function animalClasses(sales: CattleSale[]): string[] {
  const counts = new Map<string, number>()
  for (const s of sales) {
    if (!s.animal_class) continue
    counts.set(s.animal_class, (counts.get(s.animal_class) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k)
}

/** Colour per class, stable so a line keeps its colour as the filter changes. */
export const CLASS_COLOURS: Record<string, string> = {
  heifers: '#db2777',
  bulls: '#1d4ed8',
  steers: '#0f766e',
  runts: '#a16207',
}
export const CLASS_FALLBACK = '#64748b'

export type ClassSeriesPoint = { year: number } & Record<string, number | null>

/**
 * A price line per class, per year, weighted by pounds like everything else.
 *
 * One row per year with a column per class, which is the shape Recharts wants
 * for several lines on shared axes. A class with no sale in a year is null
 * rather than absent, so the line breaks over the gap instead of drawing
 * straight through a year nothing was sold.
 */
export function byYearAndClass(sales: CattleSale[], classes: string[]): ClassSeriesPoint[] {
  const years = [...new Set(sales.map((s) => s.crop_year))].sort((a, b) => a - b)
  return years.map((year) => {
    const point: ClassSeriesPoint = { year }
    for (const c of classes) {
      point[c] = yearAverage(sales.filter((s) => s.crop_year === year && s.animal_class === c))
    }
    return point
  })
}

export type YearRow = {
  year: number
  ranch: string
  price: number | null
  head: number
  lb: number
  forward: boolean
  daysAhead: number | null
  saleDate: string | null
  deliveryDate: string | null
}

/** One row per year and ranch, for the history chart and the hindsight table. */
export function byYear(sales: CattleSale[]): YearRow[] {
  const groups = new Map<string, CattleSale[]>()
  for (const s of sales) {
    const key = `${s.crop_year}|${s.ranch}`
    const list = groups.get(key) ?? []
    list.push(s)
    groups.set(key, list)
  }
  const rows: YearRow[] = []
  for (const [key, list] of groups) {
    const [year, ranch] = key.split('|')
    const forwardLot = list.find(wasForward)
    rows.push({
      year: Number(year),
      ranch,
      price: yearAverage(list),
      head: list.reduce((s, x) => s + (x.head ?? 0), 0),
      lb: list.reduce((s, x) => s + (x.total_lb ?? (x.head ?? 0) * (x.avg_weight_lb ?? 0)), 0),
      forward: Boolean(forwardLot),
      daysAhead: forwardLot ? daysAhead(forwardLot) : null,
      saleDate: list.find((x) => x.sale_date)?.sale_date ?? null,
      deliveryDate: list.find((x) => x.delivery_date)?.delivery_date ?? null,
    })
  }
  return rows.sort((a, b) => a.year - b.year || a.ranch.localeCompare(b.ranch))
}

/**
 * $/cwt to $/lb. The Alberta review quotes hundredweight; a farm talks in pounds.
 */
export const cwtToLb = (cwt: number) => cwt / 100

/**
 * The weight slide — what a lighter calf is worth per pound.
 *
 * Lighter cattle sell for MORE per pound, because the buyer is really paying for
 * the pounds they will add. Prairie Creek sells at 400-500 lb and the review's
 * lightest quote is 500-600, so their own class has to be derived.
 *
 * The slope is measured from the review itself where two adjacent classes are
 * both quoted, rather than assumed: it moves with the market and a hard-coded
 * cents-per-pound would be wrong most years. Returns null when there is nothing
 * to measure it from, because a made-up slide on a made-up class is two guesses
 * stacked.
 */
export function weightSlide(
  quotes: { lo: number; hi: number; perCwt: number }[],
): { centsPerLb: number; from: number } | null {
  // Collapse the markets first. Alberta quotes the same weight class at several
  // auctions in a week, so the two lightest ROWS are routinely the same class
  // twice — 500-600 at Strathmore and 500-600 at Ontario. Comparing a class
  // against itself gives a zero weight difference and no slide at all, which is
  // how every downstream figure on the tab silently went blank.
  const byClass = new Map<string, { lo: number; hi: number; sum: number; n: number }>()
  for (const q of quotes) {
    const key = `${q.lo}-${q.hi}`
    const e = byClass.get(key) ?? { lo: q.lo, hi: q.hi, sum: 0, n: 0 }
    e.sum += q.perCwt
    e.n += 1
    byClass.set(key, e)
  }
  const sorted = [...byClass.values()]
    .map((e) => ({ lo: e.lo, hi: e.hi, perCwt: e.sum / e.n }))
    .sort((a, b) => a.lo - b.lo)
  if (sorted.length < 2) return null
  const a = sorted[0]
  const b = sorted[1]
  const midA = (a.lo + a.hi) / 2
  const midB = (b.lo + b.hi) / 2
  if (midB === midA) return null
  // Negative: price per cwt falls as weight rises.
  return { centsPerLb: (b.perCwt - a.perCwt) / (midB - midA), from: midA }
}

/** Estimate a lighter class from the lightest quoted one, using that slide. */
export function derivePrice(
  targetMidLb: number,
  lightest: { lo: number; hi: number; perCwt: number },
  slide: { centsPerLb: number; from: number },
): number {
  const mid = (lightest.lo + lightest.hi) / 2
  return lightest.perCwt + (targetMidLb - mid) * slide.centsPerLb
}

/**
 * Basis: the Alberta cash price minus the US futures equivalent.
 *
 * A feedlot bidding on Alberta calves is working from the CME feeder board,
 * converted at the day's dollar. What is left over is basis, and it is where the
 * decision lives — a wide basis means the local market is paying under the
 * board and there is reason to wait; a narrow one means it is paying up.
 */
export function basisPerCwt(
  albertaCadPerCwt: number,
  cmeUsdPerCwt: number,
  cadPerUsd: number,
): number {
  return albertaCadPerCwt - cmeUsdPerCwt * cadPerUsd
}

export type Hindsight = {
  row: YearRow
  /** What the market did between the sale and the delivery, in $/lb. */
  marketAtSale: number | null
  marketAtDelivery: number | null
  /** Positive means locking in beat waiting. */
  advantage: number | null
}

/**
 * Score the lock-in calls already made.
 *
 * Compares the price agreed on the sale date against where the market actually
 * was by delivery. Only scored where BOTH are known — an unanswerable year is
 * left blank rather than counted as a draw, which would quietly flatter or
 * damn the record depending on which way the gaps fell.
 */
export function scoreHindsight(
  rows: YearRow[],
  marketOn: (iso: string) => number | null,
): Hindsight[] {
  return rows
    .filter((r) => r.forward && r.saleDate && r.deliveryDate && r.price != null)
    .map((row) => {
      const marketAtSale = marketOn(row.saleDate!)
      const marketAtDelivery = marketOn(row.deliveryDate!)
      return {
        row,
        marketAtSale,
        marketAtDelivery,
        advantage:
          marketAtDelivery != null && row.price != null ? row.price - marketAtDelivery : null,
      }
    })
}
