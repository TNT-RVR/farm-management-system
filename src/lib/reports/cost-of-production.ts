import type { Cell, ReportColumn, ReportData } from './framework'
import { byCrop, COST_KINDS, type BookRow, type CropBooks, type CropTotal } from './crop-books'

/**
 * Cost of production per crop: what an acre of each crop costs us, by kind,
 * and what that comes to a unit at the yield we expect — which is the price
 * the crop has to fetch to break even. From the same crop books as the Crop
 * P&L (crop-books.ts), so the two always agree.
 *
 * Cash rent paid goes in Other. A crop somebody else grows on our land (the
 * potato grower's) is left out: the grower pays its inputs, so what it costs
 * to grow is not ours to report.
 */

export const COP_COLUMNS: ReportColumn[] = [
  { label: 'Crop' },
  { label: 'Acres', decimals: 1 },
  ...COST_KINDS.map((k) => ({ label: `${k.label} /ac`, decimals: 2, money: true })),
  { label: 'Total /ac', decimals: 2, money: true },
  { label: 'Yield /ac', upTo: 2 },
  { label: 'Unit' },
  { label: 'Cost /unit', upTo: 4, money: true },
  { label: 'Price', upTo: 4, money: true },
  { label: 'B/E yield /ac', upTo: 2 },
]

/** A crop of ours to cost: not the grower's, and not land rented out. */
export const ownCrop = (r: BookRow) => Boolean(r.crop && !r.crop.renter_only && !r.crop.land_rent_only)

/** Cash rent rides in Other: it is ours to pay, and not one of the kinds a product falls under. */
const withRent = (t: CropTotal, rows: BookRow[]) => ({ ...t.costs, other: t.costs.other + rows.reduce((s, r) => s + r.rent, 0) })

export function copRow(t: CropTotal, rows: BookRow[]): Cell[] {
  const costs = withRent(t, rows)
  const perAc = (v: number) => (t.acres > 0 ? v / t.acres : null)
  const total = t.acres > 0 ? t.cost / t.acres : null
  // Fallow is not sold: an acre of it costs what it costs, and there is no unit to put that on.
  const sold = t.crop.yield_unit !== 'ac'
  return [
    t.crop.name,
    t.acres,
    ...COST_KINDS.map((k) => perAc(costs[k.key])),
    total,
    sold ? t.yieldPerAcre : null,
    sold ? t.crop.yield_unit : null,
    sold ? t.breakEvenPrice : null,
    sold ? t.price : null,
    sold ? t.breakEvenYield : null,
  ]
}

export function costOfProductionReport(books: CropBooks): ReportData {
  const rows = books.rows.filter(ownCrop)
  if (!rows.length) throw new Error(`No crop of ours is planned for ${books.year} yet.`)
  const crops = byCrop(rows)
  const forCrop = (id: string) => rows.filter((r) => r.crop!.id === id)
  const acres = crops.reduce((s, t) => s + t.acres, 0)
  const all = COST_KINDS.map((k) => crops.reduce((s, t) => s + withRent(t, forCrop(t.crop.id))[k.key], 0))
  const cost = crops.reduce((s, t) => s + t.cost, 0)
  const left = books.rows.filter((r) => r.crop && !ownCrop(r)).map((r) => r.crop!.name)
  return {
    title: 'Cost of production per crop',
    subtitle: `Crop year ${books.year}`,
    meta: [
      ['Crops', crops.length],
      ['Acres', Math.round(acres).toLocaleString('en-CA')],
      ['Average cost', acres > 0 ? `$${(cost / acres).toFixed(2)}/ac` : '—'],
      ['Fixed expenses', books.fixedPerAcre != null ? `$${books.fixedPerAcre.toFixed(2)}/ac${books.fixedFrom ? ` (${books.fixedFrom} figure)` : ''}` : 'not set'],
    ],
    summary: [
      'Dollars an acre by kind, from the Profit/Loss Map’s books: seed off the planter’s file, fertilizer and chemical as the machines applied them priced off the price book, fuel for field work and the road, trucking once the scale has the crop, and the farm’s fixed expenses (land, machinery, labour, overhead) as one figure. Other is anything added by hand on a field’s P&L, and cash rent.',
      'Cost a unit is the total an acre over the yield we expect (the scale’s where harvested, otherwise the field’s or farm’s average, or the normal yield): the price the crop must fetch to break even. Breakeven yield is the total over the price.',
      ...(left.length ? [`Left out, grown by somebody else on our land: ${[...new Set(left)].join(', ')}.`] : []),
    ],
    columns: COP_COLUMNS,
    groups: [{ title: '', rows: crops.map((t) => copRow(t, forCrop(t.crop.id))) }],
    totals: ['All crops', acres, ...all.map((v) => (acres > 0 ? v / acres : null)), acres > 0 ? cost / acres : null, null, null, null, null, null],
    orientation: 'landscape',
    filename: `Cost of production ${books.year}`,
  }
}
