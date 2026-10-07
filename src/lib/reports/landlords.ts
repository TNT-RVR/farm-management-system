import type { LandDeal } from '@/lib/land-deals'
import { fieldLabel, type Cell, type ReportColumn, type ReportData, type ReportGroup } from './framework'
import type { BookRow, CropBooks } from './crop-books'

/**
 * Landlord settlement statements: every land deal written out field by field
 * the way the cheque is worked — the crop's gross, insurance off the top, the
 * split, each side's share, and what we paid in. From the crop books
 * (crop-books.ts), so a statement and the Crop P&L can never disagree.
 *
 * One group per deal, in the order a person reads them: the land we rent in
 * (50/50s, then cash rent), then our land somebody else farms.
 */

export type LeaseTerms = {
  landlord: string
  arrangement: LandDeal['arrangement']
  direction: 'in' | 'out'
  field_ids: string[]
  owner_covers: string | null
  we_cover: string | null
  rent_per_acre: number | null
  rent_total: number | null
  our_share_pct: number | null
  inputs_shared: boolean
  active: boolean
  start_date: string | null
  end_date: string | null
}

export const STATEMENT_COLUMNS: ReportColumn[] = [
  { label: 'Field' },
  { label: 'Crop' },
  { label: 'Acres', decimals: 1 },
  { label: 'Yield /ac', upTo: 2 },
  { label: 'Production', decimals: 0 },
  { label: 'Price', upTo: 4, money: true },
  { label: 'Gross', decimals: 2, money: true },
  { label: 'Insurance off the top', decimals: 2, money: true },
  { label: 'Their share', decimals: 2, money: true },
  { label: 'Our share', decimals: 2, money: true },
  { label: 'Rent', decimals: 2, money: true },
  { label: 'Inputs we paid', decimals: 2, money: true },
  { label: 'Our net', decimals: 2, money: true },
]

const inTerm = (d: Pick<LeaseTerms, 'active' | 'start_date' | 'end_date'>, year: number) =>
  d.active && (!d.start_date || d.start_date <= `${year}-12-31`) && (!d.end_date || d.end_date >= `${year}-01-01`)

/** The deal's terms in a sentence, as the statement opens. */
export function termsLine(d: LeaseTerms): string {
  const ours = d.our_share_pct ?? 50
  if (d.direction === 'out') {
    if (d.arrangement === 'profit_share') return `Our land, ${d.landlord}’s crop: ${ours}% of the gross is ours; ${d.landlord} pays the inputs.`
    if (d.rent_per_acre != null) return `Our land rented to ${d.landlord} at $${d.rent_per_acre}/ac.`
    return `Our land rented to ${d.landlord}${d.rent_total != null ? ` for $${Math.round(d.rent_total).toLocaleString('en-CA')} the year` : ''}.`
  }
  if (d.arrangement === 'cash_rent')
    return d.rent_per_acre != null
      ? `Cash rent to ${d.landlord} at $${d.rent_per_acre}/ac.`
      : `Cash rent to ${d.landlord}${d.rent_total != null ? `, $${Math.round(d.rent_total).toLocaleString('en-CA')} the year` : ' (rate not set)'}.`
  if (d.arrangement === 'profit_share')
    return d.inputs_shared
      ? `${ours}/${100 - ours} of the net (gross less inputs) with ${d.landlord}.`
      : `${100 - ours}% of the gross cheque to ${d.landlord}, after hail and crop insurance come off the top; we pay the inputs out of our ${ours}%.`
  return `Crop share to ${d.landlord}.`
}

/** A statement line: one crop on one field under the deal. */
export function statementRow(r: BookRow): Cell[] {
  const gross = r.gross == null && !r.otherRevenue ? null : (r.gross ?? 0) + r.otherRevenue
  const paid = r.cost - r.rent
  return [
    fieldLabel(r.field),
    r.crop?.name ?? 'Nothing planted',
    r.acres || null,
    r.yieldPerAcre,
    r.yieldPerAcre != null ? r.yieldPerAcre * r.acres : null,
    r.price,
    gross,
    r.insurance || null,
    r.ownerShare || null,
    gross == null ? null : gross - r.ownerShare,
    r.rent ? -r.rent : r.rentReceived || null,
    paid || null,
    r.margin,
  ]
}

/** The rows a deal covers: the book rows whose deal it is. */
export function rowsUnder(books: CropBooks, d: LeaseTerms): BookRow[] {
  return books.rows.filter((r) => r.landDeal && r.landDeal.landlord === d.landlord && (r.landDeal.direction ?? 'in') === d.direction && d.field_ids.includes(r.fieldId))
}

const ORDER = (d: LeaseTerms) => (d.direction === 'out' ? 2 : d.arrangement === 'cash_rent' ? 1 : 0)

export function statementGroups(books: CropBooks, leases: LeaseTerms[], fieldName: (id: string) => string): ReportGroup[] {
  const deals = leases.filter((d) => inTerm(d, books.year)).sort((a, b) => ORDER(a) - ORDER(b) || a.landlord.localeCompare(b.landlord))
  return deals.map((d) => {
    const rows = rowsUnder(books, d)
    const covered = new Set(rows.map((r) => r.fieldId))
    const idle = d.field_ids.filter((id) => !covered.has(id))
    const flat = books.rentIn.find((x) => x.landlord === d.landlord && d.direction === 'out')
    const sum = (f: (r: BookRow) => number) => rows.reduce((s, r) => s + f(r), 0)
    const gross = sum((r) => (r.gross ?? 0) + r.otherRevenue)
    const owner = sum((r) => r.ownerShare)
    const rent = sum((r) => r.rent)
    const received = sum((r) => r.rentReceived) + (flat?.amount ?? 0)
    const net = sum((r) => r.margin ?? 0) + (flat?.amount ?? 0)
    const note = [
      termsLine(d),
      d.owner_covers ? `${d.direction === 'out' ? d.landlord : 'The owner'} covers: ${d.owner_covers}.` : null,
      d.we_cover ? `We cover: ${d.we_cover}.` : null,
      rows.some((r) => r.yieldFrom !== 'actual' && r.gross != null) ? 'Fields not yet off the scale are at the expected yield.' : null,
      idle.length && !flat ? `Nothing of ours planned on ${idle.map((id) => fieldLabel(fieldName(id))).join(', ')}.` : null,
    ]
      .filter(Boolean)
      .join(' ')
    const lines = rows.map(statementRow)
    // Land rented out for a flat rent has no crop of ours on it: list what the renter grows, then the rent once.
    if (flat)
      for (const id of idle)
        for (const o of books.offBooks.filter((x) => x.field === fieldName(id)))
          lines.push([fieldLabel(o.field), o.crop, o.acres, null, null, null, null, null, null, null, null, null, null])
    if (flat) lines.push(['The year’s rent', null, null, null, null, null, null, null, null, null, flat.amount, null, flat.amount])
    return {
      title: d.direction === 'out' ? `${d.landlord} (our land)` : d.landlord,
      note,
      rows: lines,
      totals: ['Statement total', null, sum((r) => r.acres), null, null, null, gross || null, sum((r) => r.insurance) || null, owner || null, gross ? gross - owner : null, rent ? -rent : received || null, sum((r) => r.cost - r.rent) || null, net],
    }
  })
}

export function landlordReport(books: CropBooks, leases: LeaseTerms[], fieldName: (id: string) => string): ReportData {
  const groups = statementGroups(books, leases, fieldName)
  if (!groups.length) throw new Error(`No land deal is in term for ${books.year}.`)
  return {
    title: 'Landlord settlement statements',
    subtitle: `Crop year ${books.year}`,
    meta: [
      ['Deals', groups.length],
      ['Owners’ shares', `$${Math.round(groups.reduce((s, g) => s + Number(g.totals?.[8] ?? 0), 0)).toLocaleString('en-CA')}`],
    ],
    summary: [
      'One statement per land deal. Gross is the crop at the Financials plan’s yield and price (the scale’s yield where harvested). Insurance is the hail and crop insurance on the field’s P&L, which comes off the cheque before the split. Their share is the land owner’s (or, on our land, the grower’s). Rent is cash rent we pay (negative) or receive.',
      'Inputs we paid are everything on our side of the field’s books — seed, fertilizer, chemical, fuel, trucking and the farm’s fixed $/ac — so Our net matches the field’s margin on the Crop P&L.',
    ],
    columns: STATEMENT_COLUMNS,
    groups,
    groupLabel: 'Deal',
    orientation: 'landscape',
    filename: `Landlord statements ${books.year}`,
  }
}
