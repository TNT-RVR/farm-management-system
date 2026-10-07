import { supabase } from '@/lib/supabase'
import { LB_PER_TONNE, boardPriceIn } from '@/lib/board-price'
import { bushelWeightFor } from '@/lib/bushels'
import { binNumber } from '@/lib/bins'
import { fetchAll, longDate, num, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * What is in every bin on a day, by crop, and what it is worth: the bins'
 * running balance from the grain ledger (every load augered in, every
 * transfer and delivery out, up to that day), plus what somebody wrote down
 * as sitting in a bin from before the ledger — last year's durum in #2 —
 * which the ledger never saw come in.
 *
 * Valued at the newest market quote for the crop on or before the day (the
 * Markets page's series, converted into the crop's own unit as the
 * marketing screens do), else at the crop plan's price for the grain's year.
 * Each row says which, and when the quote is from.
 */

export const INVENTORY_COLUMNS = [
  { label: 'Bin' },
  { label: 'Site' },
  { label: 'Crop year', align: 'left' as const },
  { label: 'Bushels', decimals: 0 },
  { label: 'Tonnes', decimals: 1 },
  { label: 'Full (%)', decimals: 0 },
  { label: 'Price', upTo: 3, money: true },
  { label: 'Per' },
  { label: 'Value', decimals: 0, money: true },
  { label: 'Priced from' },
]

export type InvBin = { id: string; name: string; site: string | null; capacity_bu: unknown; active: boolean }
export type InvCrop = { id: string; name: string; yield_unit: string | null; test_weight_lb_per_bu: unknown }
export type Movement = { bin_id: string; crop_id: string | null; crop_year: number; movement_type: string; bushels: unknown; moved_at: string }
export type Content = { bin_id: string; crop_id: string | null; crop_year: number; bushels: unknown; note: string | null; filled_on: string | null; emptied_on: string | null }
export type Quote = { crop_id: string; series: string; unit: string | null; value: number; on: string }
export type PlanPrice = { crop_id: string; crop_year: number; price_per_unit: unknown }

const INFLOW = new Set(['harvest_in', 'transfer_in', 'adjustment'])

/** A crop's unit an amount of bushels makes: 1 for bushels, the bushel's pounds for lbs, a hundredth of that for cwt. */
export function unitsPerBushel(unit: string | null, lbPerBu: number | null): number | null {
  const u = (unit ?? 'bu').toLowerCase()
  if (u === 'bu') return 1
  if (lbPerBu == null) return null
  if (u === 'lbs' || u === 'lb') return lbPerBu
  if (u === 'cwt') return lbPerBu / 100
  if (u === 'mt' || u === 'tonne' || u === 't') return lbPerBu / LB_PER_TONNE
  if (u === 'ton') return lbPerBu / 2000
  return null
}

export type InventoryLine = { binId: string; cropId: string | null; cropYear: number | null; bu: number | null; note: string | null }

/**
 * Each bin's grain on the day: the ledger's balance by crop and year, then
 * any recorded contents the ledger has no grain of that crop for (carry-over
 * written down by hand, often without a bushel figure).
 */
export function binLines(moves: Movement[], contents: Content[], asOf: string): InventoryLine[] {
  const bal = new Map<string, InventoryLine>()
  for (const m of moves) {
    if (m.moved_at > asOf) continue
    const k = `${m.bin_id}:${m.crop_id}:${m.crop_year}`
    const line = bal.get(k) ?? { binId: m.bin_id, cropId: m.crop_id, cropYear: m.crop_year, bu: 0, note: null }
    const bu = num(m.bushels) ?? 0
    line.bu = (line.bu ?? 0) + (INFLOW.has(m.movement_type) ? bu : -bu)
    bal.set(k, line)
  }
  const out = [...bal.values()].filter((l) => (l.bu ?? 0) > 0.5)
  for (const c of contents) {
    if ((c.filled_on && c.filled_on > asOf) || (c.emptied_on && c.emptied_on <= asOf)) continue
    if (out.some((l) => l.binId === c.bin_id && l.cropId === c.crop_id)) continue
    out.push({ binId: c.bin_id, cropId: c.crop_id, cropYear: c.crop_year, bu: num(c.bushels), note: c.note })
  }
  return out
}

export type Priced = { price: number; per: string; from: string }

/** The crop's price: the newest quote converted into its unit, else the plan's price for the grain's year (or the latest before). */
export function priceFor(crop: InvCrop, cropYear: number | null, quotes: Quote[], plan: PlanPrice[]): Priced | null {
  const unit = crop.yield_unit ?? 'bu'
  const tw = num(crop.test_weight_lb_per_bu)
  for (const q of quotes.filter((x) => x.crop_id === crop.id).sort((a, b) => b.on.localeCompare(a.on))) {
    const b = boardPriceIn(q.value, q.unit, { name: crop.name, unit, testWeightLbPerBu: tw })
    if (b) return { price: b.value, per: unit, from: `${q.series}, ${q.on}` }
  }
  const mine = plan.filter((x) => x.crop_id === crop.id && num(x.price_per_unit) != null && (cropYear == null || x.crop_year <= cropYear)).sort((a, b) => b.crop_year - a.crop_year)[0]
  return mine ? { price: num(mine.price_per_unit)!, per: unit, from: `crop plan price, ${mine.crop_year}` } : null
}

export function inventoryGroups(lines: InventoryLine[], bins: InvBin[], crops: InvCrop[], quotes: Quote[], plan: PlanPrice[]): { groups: ReportGroup[]; bu: number; tonnes: number; value: number; unvalued: number; unmeasured: number } {
  const binById = new Map(bins.map((b) => [b.id, b]))
  const cropById = new Map(crops.map((c) => [c.id, c]))
  const byCrop = new Map<string, { bin: string; cells: Cell[]; bu: number; t: number; v: number }[]>()
  let unvalued = 0
  let unmeasured = 0
  for (const l of lines) {
    const bin = binById.get(l.binId)
    const crop = l.cropId ? cropById.get(l.cropId) : undefined
    const lb = crop ? (bushelWeightFor(crop.name, num(crop.test_weight_lb_per_bu))?.lbPerBu ?? null) : null
    const tonnes = l.bu != null && lb != null ? (l.bu * lb) / LB_PER_TONNE : null
    const cap = num(bin?.capacity_bu)
    const priced = crop ? priceFor(crop, l.cropYear, quotes, plan) : null
    const per = crop ? unitsPerBushel(crop.yield_unit, lb) : null
    const value = priced && per != null && l.bu != null ? l.bu * per * priced.price : null
    if (l.bu == null) unmeasured++
    else if (value == null) unvalued++
    const name = crop?.name ?? 'Crop not set'
    const list = byCrop.get(name) ?? []
    list.push({
      bin: bin?.name ?? 'Bin',
      bu: l.bu ?? 0,
      t: tonnes ?? 0,
      v: value ?? 0,
      cells: [bin?.name ?? 'Bin', bin?.site ?? null, l.cropYear != null ? String(l.cropYear) : null, l.bu, tonnes, cap && l.bu != null ? (100 * l.bu) / cap : null, priced?.price ?? null, priced ? `$/${priced.per}` : null, value, l.bu == null ? (l.note ?? 'bushels not measured') : (priced?.from ?? 'no price')],
    })
    byCrop.set(name, list)
  }
  let bu = 0
  let tonnes = 0
  let value = 0
  const groups = [...byCrop.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([crop, rows]) => {
      rows.sort((a, b) => binNumber(a.bin) - binNumber(b.bin) || a.bin.localeCompare(b.bin))
      const g = { bu: rows.reduce((s, r) => s + r.bu, 0), t: rows.reduce((s, r) => s + r.t, 0), v: rows.reduce((s, r) => s + r.v, 0) }
      bu += g.bu
      tonnes += g.t
      value += g.v
      return { title: crop, note: `${rows.length} bin${rows.length === 1 ? '' : 's'}`, rows: rows.map((r) => r.cells), totals: [`${crop} total`, null, null, g.bu, g.t, null, null, null, g.v, null] }
    })
  return { groups, bu, tonnes, value, unvalued, unmeasured }
}

export async function gatherGrainInventory(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const asOf = p.asOf || ctx.today
  const [bins, crops, moves, contents, series, plan] = await Promise.all([
    fetchAll<InvBin>((a, b) => supabase.from('bins').select('id, name, site, capacity_bu, active').order('id').range(a, b)),
    fetchAll<InvCrop>((a, b) => supabase.from('crops').select('id, name, yield_unit, test_weight_lb_per_bu').order('id').range(a, b)),
    fetchAll<Movement>((a, b) => supabase.from('grain_movements').select('bin_id, crop_id, crop_year, movement_type, bushels, moved_at').lte('moved_at', asOf).order('id').range(a, b)),
    fetchAll<Content>((a, b) => supabase.from('bin_contents').select('bin_id, crop_id, crop_year, bushels, note, filled_on, emptied_on').order('id').range(a, b)),
    fetchAll<{ id: string; name: string; unit: string | null; crop_id: string | null }>((a, b) => supabase.from('market_series').select('id, name, unit, crop_id').eq('kind', 'crop').not('crop_id', 'is', null).order('id').range(a, b)),
    fetchAll<PlanPrice>((a, b) => supabase.from('crop_prices').select('crop_id, crop_year, price_per_unit').order('id').range(a, b)),
  ])
  const lines = binLines(moves, contents, asOf)
  if (!lines.length) throw new Error(`No grain in any bin on ${longDate(asOf)}.`)
  // The newest quote on or before the day, for the crops in the bins only.
  const held = new Set(lines.map((l) => l.cropId))
  const wanted = series.filter((s) => held.has(s.crop_id))
  const quotes = (
    await Promise.all(
      wanted.map(async (s) => {
        const { data, error } = await supabase.from('market_prices').select('value, observed_on').eq('series_id', s.id).lte('observed_on', asOf).order('observed_on', { ascending: false }).limit(1)
        if (error) throw new Error(error.message)
        const q = data?.[0]
        const v = num(q?.value)
        return q && v != null ? [{ crop_id: s.crop_id!, series: s.name, unit: s.unit, value: v, on: q.observed_on }] : []
      }),
    )
  ).flat()
  const r = inventoryGroups(lines, bins, crops, quotes, plan)
  const summary = [
    'Every bin with grain in it on the day, by crop: the bins’ running balance from the loads weighed in and the grain moved out, plus grain written down as already in a bin before the ledger began.',
    'Valued at the newest market quote for the crop on or before the day, converted into the crop’s unit; where the Markets page has no series for the crop, at the crop plan’s price. Tonnes are at the crop’s bushel weight.',
  ]
  if (r.unmeasured) summary.push(`${r.unmeasured} bin${r.unmeasured === 1 ? ' holds' : 's hold'} grain with no bushels written down, so ${r.unmeasured === 1 ? 'it is' : 'they are'} not counted or valued.`)
  if (r.unvalued) summary.push(`${r.unvalued} line${r.unvalued === 1 ? ' has' : 's have'} no price to value ${r.unvalued === 1 ? 'it' : 'them'} at.`)
  return {
    title: 'Grain inventory',
    subtitle: `In the bins on ${longDate(asOf)}`,
    meta: [
      ['Bins with grain', new Set(lines.map((l) => l.binId)).size],
      ['Bushels', Math.round(r.bu).toLocaleString('en-CA')],
      ['Tonnes', r.tonnes.toLocaleString('en-CA', { maximumFractionDigits: 1 })],
      ['Value', `$${Math.round(r.value).toLocaleString('en-CA')}`],
    ],
    summary,
    columns: INVENTORY_COLUMNS,
    groups: r.groups,
    groupLabel: 'Crop',
    totals: ['All crops', null, null, r.bu, r.tonnes, null, null, null, r.value, null],
    orientation: 'landscape',
    filename: `Grain inventory ${asOf}`,
  }
}
