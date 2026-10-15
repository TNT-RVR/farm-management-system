import { supabase } from '@/lib/supabase'
import { fetchLatestCropPrices, toPosition, type CropBoard } from '@/lib/marketing-data'
import { isMarketable, summarise, type Position } from '@/lib/marketing'
import { resolvePrice, type PriceRow } from '@/lib/forecast'
import { bushelWeightFor, convertMass } from '@/lib/bushels'
import { massUnit } from '@/lib/trucking'
import { fetchAll, num, yearParam, type Cell, type GatherContext, type ParamValues, type ReportColumn, type ReportData, type ReportGroup } from './framework'

/**
 * Marketing position: for each crop we sell, what we expect to grow, what is
 * contracted, what is still unpriced and what it is worth, and what is
 * sitting in the bins — the Markets page's position (the crop_position view
 * and marketing.ts summarise) as a file.
 *
 * Bins hold bushels whatever the crop is sold in (the beans went in at
 * 60 lb/bu), so a bin of a crop sold by the pound is turned into pounds at
 * the crop's bushel weight before it is valued. The price for the open
 * position and the bins is today's board price in the crop's unit, as on
 * the Markets page; a crop with no board price uses the year's own price (or
 * the latest earlier one, carried), and says so.
 */

export const POSITION_COLUMNS: ReportColumn[] = [
  { label: 'Crop' },
  { label: 'Unit' },
  { label: 'Acres', decimals: 1 },
  { label: 'Expected', decimals: 0 },
  { label: 'Contracted', decimals: 0 },
  { label: 'Delivered', decimals: 0 },
  { label: 'Unpriced', decimals: 0 },
  { label: 'Priced %', decimals: 0 },
  { label: 'Avg contract', upTo: 4, money: true },
  { label: 'Price', upTo: 4, money: true },
  { label: 'Price from' },
  { label: 'Unpriced value', decimals: 0, money: true },
  { label: 'In bins', decimals: 0 },
  { label: 'Bin value', decimals: 0, money: true },
]

export type BinStock = { bin: string; site: string | null; cropId: string; bushels: number }
export type CropLite = { id: string; name: string; yield_unit: string | null; test_weight_lb_per_bu: unknown }

/** Bushels in a bin, in the unit the crop is sold in. Null when the crop cannot be weighed. */
export function inCropUnit(bushels: number, crop: CropLite): number | null {
  const to = massUnit(crop.yield_unit)
  if (to === 'bu') return bushels
  if (!to) return null
  const lb = bushelWeightFor(crop.name, num(crop.test_weight_lb_per_bu))?.lbPerBu ?? null
  return convertMass(bushels, 'bu', to, lb)
}

/** The price a crop's unsold grain is valued at: the board, else the year's price, else an earlier one. */
export function valuePrice(cropId: string, year: number, board: CropBoard | undefined, prices: PriceRow[], currentYear: number): { value: number | null; from: string } {
  if (board) return { value: board.value, from: `${board.name}, ${board.on}` }
  const r = resolvePrice(cropId, year, prices, { currentYear })
  return { value: r.value, from: r.basis === 'none' ? 'no price' : r.label }
}

export function positionGroups(
  positions: Position[],
  bins: BinStock[],
  crops: Map<string, CropLite>,
  priceOf: (cropId: string) => { value: number | null; from: string },
): { groups: ReportGroup[]; unpricedValue: number; binValue: number; hidden: string[] } {
  const shown = positions.filter(isMarketable).sort((a, b) => a.cropName.localeCompare(b.cropName))
  const hidden = positions.filter((p) => !isMarketable(p)).map((p) => p.cropName)
  const binsOf = (cropId: string) => bins.filter((b) => b.cropId === cropId)
  let unpricedValue = 0
  let binValue = 0
  const rows: Cell[][] = shown.map((p) => {
    const s = summarise(p)
    const price = priceOf(p.cropId)
    const crop = crops.get(p.cropId)
    const each = crop ? binsOf(p.cropId).map((b) => inCropUnit(b.bushels, crop)) : []
    // One bin that cannot be weighed makes the crop's total unknown, not short.
    const inBins = each.some((v) => v == null) ? null : each.reduce<number>((t, v) => t + v!, 0)
    const open = s.openValueAt(price.value)
    const stored = inBins != null && price.value != null ? inBins * price.value : null
    unpricedValue += open ?? 0
    binValue += stored ?? 0
    return [
      p.cropName,
      p.unit,
      p.acres,
      p.expected,
      p.contracted || null,
      p.delivered || null,
      s.open,
      s.pricedFraction == null ? null : s.pricedFraction * 100,
      s.avgContractPrice,
      price.value,
      price.from,
      open,
      inBins || null,
      stored || null,
    ]
  })
  // Each bin on its own line: which bin, what, how much, and its worth.
  const binRows: Cell[][] = bins
    .filter((b) => b.bushels > 0)
    .sort((a, b) => a.bin.localeCompare(b.bin, undefined, { numeric: true }))
    .map((b) => {
      const crop = crops.get(b.cropId)
      const qty = crop ? inCropUnit(b.bushels, crop) : null
      const price = priceOf(b.cropId)
      const name = `${b.bin}${b.site && !b.bin.startsWith(b.site) ? ` · ${b.site}` : ''}`
      return [
        name,
        crop?.yield_unit ?? null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        price.value,
        crop ? `${crop.name}${crop.yield_unit !== 'bu' ? `, ${Math.round(b.bushels).toLocaleString('en-CA')} bu` : ''}` : null,
        null,
        qty,
        qty != null && price.value != null ? qty * price.value : null,
      ]
    })
  const groups: ReportGroup[] = [{ title: 'By crop', rows }]
  if (binRows.length) groups.push({ title: 'In the bins', note: 'Each bin’s grain in the unit its crop is sold in, at the same price as above.', rows: binRows })
  return { groups, unpricedValue, binValue, hidden }
}

export async function gatherMarketingPosition(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const [positions, board, crops, prices, stock, binsList] = await Promise.all([
    supabase.from('crop_position').select('*').eq('crop_year', year),
    fetchLatestCropPrices(),
    supabase.from('crops').select('id, name, yield_unit, test_weight_lb_per_bu'),
    fetchAll<PriceRow>((a, b) => supabase.from('crop_prices').select('crop_id, crop_year, price_per_unit').order('id').range(a, b)),
    supabase.from('bin_grain_onhand').select('bin_id, crop_id, onhand_bu'),
    supabase.from('bins').select('id, name, site'),
  ])
  for (const r of [positions, crops, stock, binsList]) if (r.error) throw new Error(r.error.message)
  const list = (positions.data ?? []).map(toPosition)
  if (!list.length) throw new Error(`Nothing is planned or contracted for ${year} yet.`)
  const cropMap = new Map((crops.data ?? []).map((c) => [c.id, c as CropLite]))
  const binName = new Map((binsList.data ?? []).map((b) => [b.id, b]))
  // The position's own bins column (crop_position.onhand) counts every bin of the crop, whatever year it came off.
  const bins: BinStock[] = (stock.data ?? [])
    .filter((s) => s.crop_id && s.bin_id && (num(s.onhand_bu) ?? 0) > 0)
    .map((s) => ({ bin: binName.get(s.bin_id!)?.name ?? 'Bin', site: binName.get(s.bin_id!)?.site ?? null, cropId: s.crop_id!, bushels: num(s.onhand_bu)! }))
  const currentYear = Number(ctx.today.slice(0, 4))
  const r = positionGroups(list, bins, cropMap, (id) => valuePrice(id, year, board.byCrop.get(id), prices, currentYear))
  const contracts = list.reduce((s, x) => s + x.contracted, 0)
  return {
    title: 'Marketing position',
    subtitle: `Crop year ${year} · as at ${ctx.today}`,
    meta: [
      ['Crops', r.groups[0].rows.length],
      ['Contracted', contracts ? 'yes' : 'none recorded'],
      ['Unpriced value', `$${Math.round(r.unpricedValue).toLocaleString('en-CA')}`],
      ['In the bins', `$${Math.round(r.binValue).toLocaleString('en-CA')}`],
    ],
    summary: [
      'Expected is the plan’s acres at each field’s yield (the harvest yield where it is in, else the crop’s normal yield), as the Markets page counts it. Contracted and delivered are from Contracts, cancelled ones left out. Unpriced is expected less contracted.',
      'Price is today’s board price in the crop’s unit where a market series carries the crop; otherwise the year’s price from the crop’s settings, or an earlier year’s, named. In bins counts every bin of the crop, last year’s grain included.',
      ...(contracts ? [] : [`No contracts are recorded for ${year}, so all of it shows as unpriced.`]),
      ...(r.hidden.length ? [`Not sold, so not listed: ${r.hidden.join(', ')}.`] : []),
    ],
    columns: POSITION_COLUMNS,
    groups: r.groups,
    groupLabel: 'Section',
    orientation: 'landscape',
    filename: `Marketing position ${year}`,
  }
}
