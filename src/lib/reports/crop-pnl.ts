import { fieldLabel, type Cell, type ReportColumn, type ReportData, type ReportGroup } from './framework'
import { byCrop, dealNetOf, type BookRow, type CropBooks, type CropTotal } from './crop-books'

/**
 * Crop P&L by field and farm: the crop books (crop-books.ts) as a summary by
 * crop, then every field under its crop. Revenue is ours before any split;
 * the land-deal column is what the deal moves (the owner's share and cash
 * rent off, rent received on); the margin is what is left after every cost.
 * Breakeven is the budget's (planner.ts): cost an acre over the yield, and
 * over the price — before the land owner's share.
 */

export const PNL_COLUMNS: ReportColumn[] = [
  { label: 'Field' },
  { label: 'Crop' },
  { label: 'Acres', decimals: 1 },
  { label: 'Yield /ac', upTo: 2 },
  { label: 'Yield from' },
  { label: 'Price', upTo: 4, money: true },
  { label: 'Price from' },
  { label: 'Revenue', decimals: 0, money: true },
  { label: 'Land deal', decimals: 0, money: true },
  { label: 'Inputs', decimals: 0, money: true },
  { label: 'Fixed', decimals: 0, money: true },
  { label: 'Fuel & trucking', decimals: 0, money: true },
  { label: 'Margin /ac', decimals: 2, money: true },
  { label: 'Margin', decimals: 0, money: true },
  { label: 'B/E price', upTo: 4, money: true },
  { label: 'B/E yield /ac', upTo: 2 },
]

const per = (v: number, acres: number) => (acres > 0 ? v / acres : null)
const unitOf = (u: string | null) => (u ? ` ${u}` : '')

export function pnlFieldRow(r: BookRow): Cell[] {
  const costPerAcre = per(r.cost, r.acres)
  return [
    fieldLabel(r.field),
    r.crop?.name ?? 'No crop planned',
    r.acres || null,
    r.yieldPerAcre,
    r.yieldFrom === 'none' ? null : r.yieldFrom,
    r.price,
    r.priceFrom || null,
    r.gross == null && !r.otherRevenue ? null : (r.gross ?? 0) + r.otherRevenue,
    dealNetOf(r) || null,
    r.inputs,
    r.costs.fixed,
    r.costs.fuel + r.costs.trucking,
    r.margin == null ? null : per(r.margin, r.acres),
    r.margin,
    costPerAcre != null && r.yieldPerAcre ? costPerAcre / r.yieldPerAcre : null,
    costPerAcre != null && r.price ? costPerAcre / r.price : null,
  ]
}

export function pnlCropRow(t: CropTotal): Cell[] {
  return [
    `${t.fields} field${t.fields === 1 ? '' : 's'}`,
    `${t.crop.name}${t.crop.yield_unit && t.crop.yield_unit !== 'ac' ? ` (${t.crop.yield_unit})` : ''}`,
    t.acres,
    t.yieldPerAcre,
    null,
    t.price,
    null,
    t.gross,
    t.dealNet || null,
    t.inputs,
    t.costs.fixed,
    t.costs.fuel + t.costs.trucking,
    per(t.margin, t.acres),
    t.margin,
    t.breakEvenPrice,
    t.breakEvenYield,
  ]
}

/** One totals row over many crops or fields: sums only, no yields or prices to average. */
function sumRow(label: string, rows: { acres: number; gross: number; dealNet: number; inputs: number; fixed: number; fuelTrucking: number; margin: number }[]): Cell[] {
  const s = rows.reduce(
    (a, r) => ({
      acres: a.acres + r.acres,
      gross: a.gross + r.gross,
      dealNet: a.dealNet + r.dealNet,
      inputs: a.inputs + r.inputs,
      fixed: a.fixed + r.fixed,
      fuelTrucking: a.fuelTrucking + r.fuelTrucking,
      margin: a.margin + r.margin,
    }),
    { acres: 0, gross: 0, dealNet: 0, inputs: 0, fixed: 0, fuelTrucking: 0, margin: 0 },
  )
  return [label, null, s.acres, null, null, null, null, s.gross, s.dealNet || null, s.inputs, s.fixed, s.fuelTrucking, per(s.margin, s.acres), s.margin, null, null]
}

const fromTotal = (t: CropTotal) => ({ acres: t.acres, gross: t.gross, dealNet: t.dealNet, inputs: t.inputs, fixed: t.costs.fixed, fuelTrucking: t.costs.fuel + t.costs.trucking, margin: t.margin })
const fromRow = (r: BookRow) => ({
  acres: r.acres,
  gross: (r.gross ?? 0) + r.otherRevenue,
  dealNet: dealNetOf(r),
  inputs: r.inputs,
  fixed: r.costs.fixed,
  fuelTrucking: r.costs.fuel + r.costs.trucking,
  margin: r.margin ?? 0,
})

export function pnlGroups(books: CropBooks): { groups: ReportGroup[]; totals: Cell[]; crops: CropTotal[] } {
  const crops = byCrop(books.rows)
  const rentRows = books.rentIn.map((r) => ({ acres: 0, gross: 0, dealNet: r.amount, inputs: 0, fixed: r.landShare, fuelTrucking: 0, margin: r.amount - r.landShare }))
  const summary: ReportGroup = {
    title: 'Summary by crop',
    note: 'Each crop’s fields together. Price is the average the crop is carried at; breakeven is the cost an acre over the yield, and over the price.',
    rows: [
      ...crops.map(pnlCropRow),
      ...books.rentIn.map((r) => ['Rent received', `Land rented out to ${r.landlord}${r.landShare ? ', less its land share of the fixed expenses' : ''}`, null, null, null, null, null, null, r.amount, null, r.landShare || null, null, null, r.amount - r.landShare, null, null] as Cell[]),
    ],
  }
  const byCropId = new Map<string, BookRow[]>()
  const none: BookRow[] = []
  for (const r of books.rows) {
    if (!r.crop) none.push(r)
    else byCropId.set(r.crop.id, [...(byCropId.get(r.crop.id) ?? []), r])
  }
  const fieldGroups: ReportGroup[] = crops.map((t) => {
    const rows = byCropId.get(t.crop.id) ?? []
    const unknown = rows.filter((r) => r.margin == null).length
    return {
      title: `${t.crop.name}${unitOf(t.crop.yield_unit && t.crop.yield_unit !== 'ac' ? `· ${t.crop.yield_unit}` : null)}`,
      note: unknown ? `${unknown} field${unknown === 1 ? ' has' : 's have'} no yield or no price yet, so no margin: its costs are in the crop’s costs, not in its margin.` : undefined,
      rows: rows.map(pnlFieldRow),
      totals: pnlCropRow(t).map((c, i) => (i === 0 ? 'Crop total' : i === 1 ? null : c)),
    }
  })
  if (none.length)
    fieldGroups.push({
      title: 'Costs on fields with nothing of ours planned',
      rows: none.map(pnlFieldRow),
      totals: sumRow('Total', none.map(fromRow)),
    })
  const totals = sumRow('Whole farm', [...crops.map(fromTotal), ...none.map(fromRow), ...rentRows])
  return { groups: [summary, ...fieldGroups], totals, crops }
}

export function cropPnlReport(books: CropBooks): ReportData {
  if (!books.rows.length) throw new Error(`Nothing is planned or applied for ${books.year} yet.`)
  const { groups, totals, crops } = pnlGroups(books)
  const actual = books.rows.filter((r) => r.yieldFrom === 'actual').length
  const margin = crops.reduce((s, t) => s + t.margin, 0) + books.rentIn.reduce((s, r) => s + r.amount - r.landShare, 0)
  const acres = crops.reduce((s, t) => s + t.acres, 0)
  return {
    title: 'Crop P&L by field and farm',
    subtitle: `Crop year ${books.year}`,
    meta: [
      ['Fields', new Set(books.rows.map((r) => r.fieldId)).size],
      ['Acres', Math.round(acres).toLocaleString('en-CA')],
      ['Harvested off the scale', `${actual} of ${books.rows.length}`],
      ['Fixed expenses', books.fixedPerAcre != null ? `$${books.fixedPerAcre.toFixed(2)}/ac${books.fixedFrom ? ` (${books.fixedFrom} figure)` : ''}` : 'not set'],
      ['Margin', `$${Math.round(margin).toLocaleString('en-CA')}`],
    ],
    summary: [
      'Acres, yield and price are the Financials plan’s: a harvested field carries its yield off the scale (“actual”); the rest carry the expected yield — this field’s own average, the farm’s, or the crop’s normal (goal) yield. Price runs contract → the year’s price (or forecast) → elevator bid (“market”) → an earlier year’s price, carried (shown as its year).',
      'Costs are the Profit/Loss Map’s: products applied by the machines priced off the price book, the farm’s fixed $/ac, fuel for field work and the road, and trucking once the scale has the crop — with anything typed on a field’s P&L. Inputs are seed, fertilizer, chemical and anything added by hand.',
      'Land deal is what the field’s deal moves: the land owner’s share of a 50/50 (after insurance off the top), the grower’s share on our land, cash rent paid, rent received. Margin is after all of it. A field with no yield or no price has no margin yet; its costs are still counted in the crop’s costs.',
      ...(books.offBooks.length ? [`Not on our books: ${books.offBooks.map((o) => `${o.crop} on ${fieldLabel(o.field)} (${o.why})`).join('; ')}.`] : []),
    ],
    columns: PNL_COLUMNS,
    groups,
    groupLabel: 'Section',
    totals,
    orientation: 'landscape',
    filename: `Crop P&L ${books.year}`,
  }
}
