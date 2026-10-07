import { supabase } from '@/lib/supabase'
import type { TableReport } from '@/lib/table-report'
import { conv, depthValue, type UnitSystem } from '@/lib/units'
import {
  buildWaterReview,
  DEFAULT_POWER_BUY_KWH,
  DEFAULT_POWER_SELL_KWH,
  MM_PER_IN,
  reviewTotals,
  type ReviewData,
  type WaterReviewRow,
  type WaterReviewTotals,
} from '@/lib/water-review'

/**
 * Water against yield for a season — the reads and the CSV.
 *
 * The review on the Irrigation overview and the Reports page both call these,
 * so the file one makes is the file the other makes. The arithmetic itself is
 * in lib/water-review.
 */

const PAGE = 1000

/** PostgREST hands back at most 1000 rows a request: read on until a short page. */
async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

/** Everything the review reads for one year. */
export async function fetchWaterReviewData(year: number): Promise<Omit<ReviewData, 'today'>> {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const [seasons, fields, plans, history, crops, pivots, pumps, flow, prices, contracts, series, events, balance] = await Promise.all([
    supabase.from('field_crop_seasons').select('field_id, zone_id, application_efficiency').eq('crop_year', year),
    supabase.from('fields').select('id, name'),
    supabase.from('crop_plans').select('field_id, crop_id, planned_acres, yield_per_acre_override, yield_basis').eq('crop_year', year),
    supabase.from('crop_history').select('field_id, crop_id, acres, yield_per_acre, yield_unit, source').eq('crop_year', year),
    supabase.from('crops').select('id, name, color, yield_unit, default_yield_per_acre, margin_per_acre, own_use'),
    supabase.from('field_pivots').select('field_id, acres_irrigated, gpm, system_capacity_ls, application_efficiency, pump_id'),
    supabase.from('pumps').select('id, name, horse_power, gpm, gpm_estimate'),
    supabase.from('fieldnet_systems').select('field_id, flow:raw->>reporting_flow'),
    supabase.from('crop_prices').select('crop_id, crop_year, price_per_unit'),
    // A cancelled contract sold nothing; the planner skips it too.
    supabase.from('contracts').select('crop_id, crop_year, bushels, price_per_unit').eq('crop_year', year).neq('status', 'cancelled'),
    supabase.from('market_series').select('id, crop_id, commodity, unit, archived').not('crop_id', 'is', null),
    allPages((a, b) => supabase.from('irrigation_events').select('id, field_id, gross_mm, net_mm').gte('date', from).lte('date', to).order('id').range(a, b)),
    // A season of 18 fields is ~3,000 rows; zones add more.
    allPages((a, b) =>
      supabase
        .from('water_balance_daily')
        .select('field_id, zone_id, date, is_forecast, rainfall_mm, etc_mm, status, ks, dr_mm, raw_mm')
        .eq('is_forecast', false)
        .gte('date', from)
        .lte('date', to)
        .order('field_id')
        .order('date')
        .order('zone_id', { nullsFirst: true })
        .range(a, b),
    ),
  ])
  for (const r of [seasons, fields, plans, history, crops, pivots, pumps, flow, prices, contracts, series]) if (r.error) throw r.error
  // The latest Alberta market price of each crop-linked series, as the rotation margins read it.
  const ids = (series.data ?? []).filter((s) => !s.archived).map((s) => s.id)
  const obs = ids.length
    ? await supabase.from('market_prices').select('series_id, observed_on, value').in('series_id', ids).gte('observed_on', `${year - 2}-01-01`).order('observed_on', { ascending: false })
    : { data: [], error: null }
  if (obs.error) throw obs.error
  const latest = new Map<string, { observed_on: string; value: number }>()
  for (const o of obs.data ?? []) if (!latest.has(o.series_id)) latest.set(o.series_id, { observed_on: o.observed_on, value: Number(o.value) })
  const market = (series.data ?? []).flatMap((s) => {
    const l = latest.get(s.id)
    return l ? [{ crop_id: s.crop_id as string, commodity: s.commodity as string | null, unit: s.unit as string | null, ...l }] : []
  })
  const n = (v: unknown) => (v == null ? null : Number(v))
  return {
    year,
    seasons: seasons.data ?? [],
    fields: fields.data ?? [],
    plans: plans.data ?? [],
    history: history.data ?? [],
    crops: crops.data ?? [],
    pivots: pivots.data ?? [],
    // A pump not yet measured shares its horsepower by the curve estimate.
    pumps: (pumps.data ?? []).map((p) => ({ ...p, gpm: p.gpm ?? p.gpm_estimate })),
    fieldnetFlow: (flow.data ?? []) as { field_id: string | null; flow: string | null }[],
    events,
    balance,
    prices: (prices.data ?? []).map((p) => ({ ...p, price_per_unit: n(p.price_per_unit) })),
    contracts: (contracts.data ?? []).map((k) => ({ ...k, bushels: n(k.bushels), price_per_unit: n(k.price_per_unit) })),
    market,
  }
}

/** What power is worth to the pumps: the solar sell price, the grid buy price, and which one the review charges. */
export type PowerPrices = {
  sell: number
  buy: number
  basis: 'sell' | 'buy'
  /** What an acre-foot of water is worth to the farm (farms.water_value_af); null when not set. */
  waterValueAf: number | null
}

/** The farm's two power prices and which one prices the pumping. */
export async function fetchFarmPowerCost() {
  const { data, error } = await supabase.from('farms').select('id, power_buy_kwh, power_sell_kwh, power_value_basis, water_value_af').limit(1).single()
  if (error) throw error
  return data
}

/** The farm row's prices, or the defaults where none is set. */
export function powerPrices(
  farm: { power_sell_kwh: number | string | null; power_buy_kwh: number | string | null; power_value_basis: string | null; water_value_af?: number | string | null } | null | undefined,
): PowerPrices {
  return {
    sell: farm?.power_sell_kwh != null ? Number(farm.power_sell_kwh) : DEFAULT_POWER_SELL_KWH,
    buy: farm?.power_buy_kwh != null ? Number(farm.power_buy_kwh) : DEFAULT_POWER_BUY_KWH,
    basis: farm?.power_value_basis === 'sell' ? 'sell' : 'buy',
    waterValueAf: farm?.water_value_af != null ? Number(farm.water_value_af) : null,
  }
}

/** Yield and dollars "per inch" read per 10 mm in metric. */
export function perDepth(u: UnitSystem) {
  return u === 'metric' ? { mm: 10, label: '10 mm' } : { mm: MM_PER_IN, label: 'in' }
}
export const perUnit = (perIn: number | null, u: UnitSystem) => (perIn == null ? null : (perIn * perDepth(u).mm) / MM_PER_IN)

/** The review as a table: a row per field, then the farm, with how power was priced. */
export function waterReviewReport(rows: WaterReviewRow[], t: WaterReviewTotals, year: number, power: PowerPrices, u: UnitSystem, today: string): TableReport {
  const unit = conv.depthUnit(u)
  const per = perDepth(u).label
  const d = (mm: number | null) => (mm == null ? null : Number(depthValue(mm, u).toFixed(u === 'metric' ? 0 : 2)))
  const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100)
  const head = [
    'Field', 'Crop', 'Irrigated acres', 'Passes', `Irrigation gross (${unit})`, 'Application efficiency', `Effective (${unit})`, `Rain (${unit})`, `Crop use ETc (${unit})`,
    'Balance days', 'Stress days', 'Days past RAW', 'Yield /ac', 'Yield unit', 'Yield from', '% of crop average', `Yield per ${per} total water`, `Yield per ${per} irrigation`,
    'Flow (gpm)', 'Flow from', 'Pump hp', 'Acre-inches', 'Pump hours', 'kWh', 'Pumping $', 'Pumping $/ac', 'Pumping $/ac-in', 'Pumping note',
    'Price', 'Price from', 'Gross $/ac', `$ per ${per} irrigation`, 'What this says',
  ]
  const body = rows.map((r) => [
    r.fieldName, r.cropName, r2(r.acres), r.events, d(r.grossMm), r.efficiency, d(r.effectiveMm), d(r.rainMm), d(r.etcMm),
    r.balanceDays, r.stressDays, r.belowThresholdDays, r2(r.yield), r.yieldUnit, r.yieldFrom, r.relYield == null ? null : Math.round(r.relYield), r2(perUnit(r.yieldPerInTotal, u)), r2(perUnit(r.yieldPerInIrrigation, u)),
    r.gpm == null ? null : Math.round(r.gpm), r.gpmFrom, r2(r.hp), r2(r.acreInches), r2(r.pumpHours), r.kwh == null ? null : Math.round(r.kwh), r2(r.pumpCost), r2(r.pumpCostPerAc), r2(r.pumpCostPerAcIn), r.pumpNote,
    r.price, r.priceFrom, r2(r.grossPerAc), r2(perUnit(r.dollarsPerInIrrigation, u)), r.verdict,
  ])
  const total = [
    `Farm (${t.fields} fields)`, '', r2(t.acres), null, d(t.grossMm), null, d(t.effectiveMm), d(t.rainMm), d(t.etcMm),
    null, r2(t.stressDays), r2(t.belowThresholdDays), null, null, null, null, null, null,
    null, null, null, r2(t.acreInches), null, null, r2(t.pumpCost), r2(t.pumpCostPerAc), r2(t.pumpCostPerAcIn), `${t.pumpFields} of ${t.fields} fields priced`,
    null, null, r2(t.grossPerAc), null, 'Depths are acre-weighted averages',
  ]
  return {
    title: `Water against yield ${year}`,
    meta: [
      ['Power valued at', power.basis === 'sell' ? `$${power.sell}/kWh, the solar sell price (income forgone)` : `$${power.buy}/kWh, the grid price`],
      ['Power the other way', power.basis === 'sell' ? `$${power.buy}/kWh from the grid: $${t.kwh != null ? Math.round(t.kwh * power.buy) : '—'}` : `$${power.sell}/kWh sell price: $${t.kwh != null ? Math.round(t.kwh * power.sell) : '—'}`],
      ['Depths in', unit],
      ['Exported', today],
    ],
    sections: [{ title: 'Fields', head, rows: [...body, total] }],
  }
}

/**
 * The season's review, from nothing: read the year, price the pumping, and
 * lay it out with the most-watered field first (the review's own default
 * order). The Reports page writes it as CSV or PDF.
 */
export async function waterReviewTable(year: number, u: UnitSystem): Promise<{ report: TableReport; rows: number }> {
  const [data, farm] = await Promise.all([fetchWaterReviewData(year), fetchFarmPowerCost()])
  const power = powerPrices(farm)
  const today = new Date().toLocaleDateString('en-CA')
  const rows = buildWaterReview({ ...data, today }, power.basis === 'sell' ? power.sell : power.buy)
  const sorted = [...rows].sort((a, b) => {
    if (a.grossMm == null && b.grossMm == null) return a.fieldName.localeCompare(b.fieldName)
    if (a.grossMm == null) return 1
    if (b.grossMm == null) return -1
    return b.grossMm - a.grossMm || a.fieldName.localeCompare(b.fieldName)
  })
  return { report: waterReviewReport(sorted, reviewTotals(rows), year, power, u, today), rows: rows.length }
}
