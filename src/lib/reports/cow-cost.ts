import { supabase } from '@/lib/supabase'
import {
  BENCHMARK_PASTURE_RENT,
  COW_CALF_BENCHMARK_COSTS,
  COW_CALF_BENCHMARK_SOURCE,
  breakEven,
  ownGrass,
  type BenchmarkLine,
  type CattleCosts,
} from '@/lib/cattleEconomics'
import { ranchSale, type SaleLot } from '@/lib/calf-sale'
import { fetchAll, num, pick, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * What a cow costs to keep for a year, by ranch and cost line, against the
 * published benchmark the Cattle settings offer as a starting point (a
 * Manitoba 150-cow budget, carried forward by the quarterly refresh where it
 * has run) — with the pasture rent taken out, because the farm owns its grass
 * (cattleEconomics.ts ownGrass). The ranch's costs are the year's, or the
 * newest earlier year's carried over, as Cattle settings shows them. Under
 * each ranch, the break-even it implies: calves sold per cow after weaning
 * and death loss, the cost a calf, and the price a pound at the farm's sale
 * weight (breakEven).
 */

export const COST_LINES: { key: keyof CattleCosts & string; label: string }[] = [
  { key: 'cow_cost_per_head', label: 'Cow cost (replacement, breeding, interest)' },
  { key: 'feed_cost_per_head', label: 'Winter feed' },
  { key: 'pasture_cost_per_head', label: 'Pasture' },
  { key: 'vet_cost_per_head', label: 'Vet and medicine' },
  { key: 'other_cost_per_head', label: 'Everything else (labour, fuel, machinery, …)' },
]

export const COW_COST_COLUMNS = [
  { label: 'Cost line' },
  { label: 'Ours ($/cow)', money: true, decimals: 0 },
  { label: 'Benchmark ($/cow)', money: true, decimals: 0 },
  { label: 'Ours − benchmark', money: true, decimals: 0 },
  { label: 'Ours × cows', money: true, decimals: 0 },
]

type CostRow = Record<string, unknown> & { ranch: string; crop_year: number }

/** The ranch's row for the year, or the newest earlier one, marked as carried. */
export function costsFor(rows: CostRow[], ranch: string, year: number): CattleCosts | null {
  const r = rows.filter((x) => x.ranch === ranch && x.crop_year <= year).sort((a, b) => b.crop_year - a.crop_year)[0]
  if (!r) return null
  const n = (k: string) => num(r[k])
  return {
    id: String(r.id ?? ''),
    ranch,
    crop_year: r.crop_year,
    cow_cost_per_head: n('cow_cost_per_head'),
    feed_cost_per_head: n('feed_cost_per_head'),
    pasture_cost_per_head: n('pasture_cost_per_head'),
    vet_cost_per_head: n('vet_cost_per_head'),
    other_cost_per_head: n('other_cost_per_head'),
    death_loss_pct: n('death_loss_pct'),
    weaning_rate_pct: n('weaning_rate_pct'),
    cost_of_gain_per_lb: n('cost_of_gain_per_lb'),
    notes: (r.notes as string | null) ?? null,
    carriedFrom: r.crop_year < year ? r.crop_year : null,
  }
}

/** The benchmark per line, pasture rent out: the refreshed copy where there is one, else the published figures. */
export function benchmarkLines(live: BenchmarkLine[] | null): Record<string, number> {
  const published: Record<string, number> = live?.length ? Object.fromEntries(live.map((l) => [l.key, l.current])) : { ...COW_CALF_BENCHMARK_COSTS }
  return { ...published, pasture_cost_per_head: ownGrass(published.pasture_cost_per_head ?? 0) }
}

export function cowCostGroup(o: { ranch: string; costs: CattleCosts | null; bench: Record<string, number>; cows: number; saleWeightLb: number; year: number }): ReportGroup {
  if (!o.costs) {
    return { title: o.ranch, note: `No costs entered for ${o.ranch} for ${o.year} or before — Cattle settings → Costs.`, rows: COST_LINES.map((l) => [l.label, null, o.bench[l.key] ?? null, null, null]) }
  }
  const c = o.costs
  const rows: Cell[][] = COST_LINES.map((l) => {
    const ours = num(c[l.key])
    const b = o.bench[l.key] ?? null
    return [l.label, ours, b, ours != null && b != null ? ours - b : null, ours != null ? ours * o.cows : null]
  })
  const ours = COST_LINES.reduce((s, l) => s + (num(c[l.key]) ?? 0), 0)
  const bench = COST_LINES.reduce((s, l) => s + (o.bench[l.key] ?? 0), 0)
  const be = breakEven(c, o.saleWeightLb)
  const missing = COST_LINES.filter((l) => c[l.key] == null).map((l) => l.label.split(' (')[0].toLowerCase())
  return {
    title: o.ranch,
    note: [
      c.carriedFrom != null ? `${c.carriedFrom}’s costs, carried to ${o.year} (nothing saved for ${o.year} yet)` : `${o.year} costs`,
      `${o.cows.toLocaleString('en-CA')} cows on the Herd tab`,
      be
        ? `weaning ${c.weaning_rate_pct ?? 100}%, death loss ${c.death_loss_pct ?? 0}% → ${be.calvesPerCow.toFixed(2)} calves sold a cow, $${Math.round(be.costPerCalf).toLocaleString('en-CA')} a calf${be.perLb != null ? `, break-even $${be.perLb.toFixed(2)}/lb at ${o.saleWeightLb} lb` : ''}`
        : null,
      missing.length ? `not entered: ${missing.join(', ')} — counted as nothing, so the total is low` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    rows,
    totals: ['Total per cow', ours, bench, ours - bench, ours * o.cows],
  }
}

export async function gatherCowCost(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const ranchId = pick(p, 'ranch')
  const [rows, ranches, herd, bench, setup, sales] = await Promise.all([
    fetchAll<CostRow>((a, b) => supabase.from('cattle_cost_assumptions').select('*').lte('crop_year', year).order('crop_year', { ascending: false }).order('id').range(a, b)),
    fetchAll<{ id: string; name: string; steer_sale_weight_lb: number | null; heifer_sale_weight_lb: number | null; calf_sale_month: number | null }>((a, b) =>
      supabase.from('ranches').select('id, name, steer_sale_weight_lb, heifer_sale_weight_lb, calf_sale_month').order('sort_order').order('id').range(a, b),
    ),
    fetchAll<{ ranch_id: string; class_name: string; head_count: number; feed_class: string | null }>((a, b) => supabase.from('herd_counts').select('ranch_id, class_name, head_count, feed_class').order('id').range(a, b)),
    supabase.from('cost_benchmarks').select('source, lines').eq('key', 'cattle_cow_calf_ab').maybeSingle(),
    supabase.from('farm_setup').select('calf_sale_weight_lb, calf_sale_month').limit(1).maybeSingle(),
    fetchAll<SaleLot>((a, b) => supabase.from('cattle_sales').select('ranch, crop_year, animal_class, head, avg_weight_lb').order('id').range(a, b)),
  ])
  if (bench.error) throw new Error(bench.error.message)
  const live = (bench.data?.lines ?? null) as unknown as BenchmarkLine[] | null
  const lines = benchmarkLines(live)
  const farm = { calfSaleWeightLb: num(setup.data?.calf_sale_weight_lb) ?? 450, calfSaleMonth: setup.data?.calf_sale_month ?? 12 }
  // Each ranch's own sale weight (typed, else its sales), steers and heifers averaged.
  const saleWeightOf = (r: (typeof ranches)[number]) => {
    const s = ranchSale(r, sales.map((x) => ({ ...x, avg_weight_lb: num(x.avg_weight_lb) })), farm)
    return Math.round((s.steers.lb + s.heifers.lb) / 2)
  }
  const shown = ranches.filter((r) => !ranchId || r.id === ranchId)
  if (!rows.some((r) => shown.some((s) => s.name === r.ranch))) throw new Error(`No cow costs are entered for ${ranchId ? (shown[0]?.name ?? 'that ranch') : 'any ranch'} for ${year} or before (Cattle settings → Costs).`)
  // Cows wintered: the cow classes on the Herd tab.
  const cowsAt = (id: string) => herd.filter((h) => h.ranch_id === id && (h.feed_class === 'cow' || /\bcows?\b/i.test(h.class_name))).reduce((s, h) => s + (Number(h.head_count) || 0), 0)
  const groups = shown.map((r) => cowCostGroup({ ranch: r.name, costs: costsFor(rows, r.name, year), bench: lines, cows: cowsAt(r.id), saleWeightLb: saleWeightOf(r), year }))
  const benchTotal = COST_LINES.reduce((s, l) => s + (lines[l.key] ?? 0), 0)
  return {
    title: 'Cost per cow',
    subtitle: `${year} · ${ranchId ? (shown[0]?.name ?? '') : 'All ranches'}`,
    meta: [
      ['Benchmark, rent out', `$${Math.round(benchTotal).toLocaleString('en-CA')} a cow`],
      ['Pasture rent taken out', `$${BENCHMARK_PASTURE_RENT.toFixed(2)} a cow`],
      ['Calf sale weight', shown.map((r) => `${r.name} ${saleWeightOf(r)} lb`).join(', ')],
    ],
    summary: [
      `Benchmark: ${bench.data?.source ?? COW_CALF_BENCHMARK_SOURCE}. It is a neighbouring province’s budget, offered as a first draft to correct — pasture and feed in particular differ a good deal in southern Alberta irrigation country.`,
      'The farm owns its grass, so the benchmark’s pasture rental is taken out of its pasture line, as Cattle settings does; what is left is the operating and fencing cost.',
      'Death loss is not a cost line: it lowers the calves sold a cow, which raises the cost a calf and the break-even.',
    ],
    columns: COW_COST_COLUMNS,
    groups,
    groupLabel: 'Ranch',
    filename: `Cost per cow ${year}${ranchId ? ` ${shown[0]?.name ?? ''}` : ''}`,
  }
}
