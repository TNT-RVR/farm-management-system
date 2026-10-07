import { compareFieldNames } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { dealFor, type LandDeal } from '@/lib/land-deals'
import { fetchAll, fieldLabel, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'
import { loadSeasonBasics, type CropArea, type SeasonBasics, type SeasonFieldRow } from './field-season'

/**
 * The seeded acreage report AFSC asks for each spring: every crop this farm
 * seeded, on which quarter, how many acres, when, and whether it is under a
 * pivot — the figures the crop insurance contract is written on. Grouped by
 * crop with each crop's total, the way the form adds them up.
 *
 * Acres are the plan's (or a split field's area's), not the map's: the plan
 * is what was seeded, and on a field with a corner rented out the map is
 * not. Somebody else's crop on our ground, a field rented out whole, and
 * fallow are not ours to insure, so they are left out and named.
 *
 * Each 50/50 joint venture is insured under its own agreement, so it gets
 * its own report with the whole field on it, and the farm's own report
 * leaves those fields off (Sam, 3 Oct 2026). A crop insured another way —
 * Corteva's seed canola carries the contract's own cover — is off every AFSC
 * report (crops.afsc_insured).
 */

export const AFSC_COLUMNS = [
  { label: 'Variety' },
  { label: 'Field' },
  { label: 'Legal land' },
  { label: 'Acres', decimals: 1 },
  { label: 'Seeded' },
  { label: 'Land' },
]

export type AcreageResult = { groups: ReportGroup[]; acres: number; irrigatedAcres: number; left: string[]; noDate: number }

/** One crop area we seeded and insure: the area, its field, pivot or not, and the seeding day. */
export type InsurableArea = { area: CropArea; field: SeasonFieldRow; irrigated: boolean; seeded: string | null }

/** The joint venture a field's crop is farmed under (its landlord), or null when it is the farm's own. */
export function jointVentureOf(deals: LandDeal[], fieldId: string, year: number, cropId: string | null): string | null {
  const d = dealFor(deals, fieldId, year, cropId)
  return d && d.direction !== 'out' && d.arrangement === 'profit_share' ? d.landlord : null
}

/** What decides whose AFSC report a crop area goes on. */
export type InsuranceContext = {
  deals: LandDeal[]
  year: number
  /** '' for the farm's own report, else the landlord of the joint venture it is for. */
  party: string
  /** Crops insured some other way (crops.afsc_insured false). */
  uninsured: Set<string>
}

/**
 * The season's crop areas that are ours to insure, and the rest named with
 * why: a field rented out whole, the renter's crop on our ground, ground not
 * seeded (fallow), a crop insured another way, and the joint ventures, which
 * each have their own report. Shared by the seeded acreage report and the
 * harvested production report, so the two list the same acres.
 */
export function insurableAreas(
  b: Pick<SeasonBasics, 'fields' | 'areas' | 'irrigated' | 'seeded' | 'rentedOut'>,
  ins?: InsuranceContext,
): { kept: InsurableArea[]; left: string[] } {
  const fieldById = new Map(b.fields.map((f) => [f.id, f]))
  const kept: InsurableArea[] = []
  const left: string[] = []
  for (const a of b.areas) {
    const f = fieldById.get(a.fieldId)
    if (!f) continue
    if (!f.active) continue
    const rented = b.rentedOut.get(f.id)
    if (rented) {
      left.push(`${fieldLabel(f.name)} (rented out to ${rented})`)
      continue
    }
    if (a.renters) {
      left.push(`${a.crop} on ${fieldLabel(f.name)} (the renter’s crop)`)
      continue
    }
    const party = ins?.party ?? ''
    const deal = ins ? dealFor(ins.deals, f.id, ins.year, a.cropId) : null
    const jv = ins ? jointVentureOf(ins.deals, f.id, ins.year, a.cropId) : null
    // A joint venture's report holds its own fields and nothing else.
    if (party && jv !== party) continue
    if (deal?.direction === 'out') {
      left.push(`${a.crop} on ${fieldLabel(f.name)} (${deal.arrangement === 'cash_rent' ? `rented out to ${deal.landlord}` : `${deal.landlord}’s crop and inputs on our land`})`)
      continue
    }
    if (ins?.uninsured.has(a.cropId)) {
      left.push(`${a.crop} on ${fieldLabel(f.name)} (insured through its contract, not AFSC)`)
      continue
    }
    if (!party && jv) {
      left.push(`${a.crop} on ${fieldLabel(f.name)} (the joint venture with ${jv}: its own report)`)
      continue
    }
    if (!a.seeded) {
      left.push(`${a.crop} on ${fieldLabel(f.name)} (not seeded this year)`)
      continue
    }
    kept.push({ area: a, field: f, irrigated: b.irrigated.has(f.id), seeded: b.seeded.get(f.id)?.date ?? null })
  }
  return { kept, left }
}

const toNum = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

/**
 * The land deals and the crops insured some other way, which decide what
 * goes on whose AFSC report. Land deals are managers' to read, so both AFSC
 * reports are managers'.
 */
export async function loadInsuranceContext(year: number, party: string): Promise<InsuranceContext> {
  const [leases, crops] = await Promise.all([
    fetchAll<LandDeal>((a, b) =>
      supabase
        .from('land_leases')
        .select('landlord, arrangement, direction, field_ids, rent_per_acre, rent_total, our_share_pct, crop_share_pct, inputs_shared, active, start_date, end_date, crop_ids')
        .order('id')
        .range(a, b),
    ),
    fetchAll<{ id: string; afsc_insured: boolean }>((a, b) => supabase.from('crops').select('id, afsc_insured').order('id').range(a, b)),
  ])
  const deals: LandDeal[] = leases.map((d) => ({
    ...d,
    field_ids: d.field_ids ?? [],
    direction: d.direction === 'out' ? 'out' : 'in',
    rent_per_acre: toNum(d.rent_per_acre),
    rent_total: toNum(d.rent_total),
    our_share_pct: toNum(d.our_share_pct),
    crop_share_pct: toNum(d.crop_share_pct),
    inputs_shared: d.inputs_shared ?? true,
  }))
  return { deals, year, party, uninsured: new Set(crops.filter((c) => c.afsc_insured === false).map((c) => c.id)) }
}

/** Who the report is for, for its subtitle. */
export const partyLabel = (party: string) => (party ? `Joint venture with ${party}` : 'Our own fields')

/** The season's crop areas as AFSC's rows, a group per crop; also what was left out and why. */
export function acreageGroups(b: Pick<SeasonBasics, 'fields' | 'areas' | 'irrigated' | 'seeded' | 'rentedOut'>, ins?: InsuranceContext): AcreageResult {
  const byCrop = new Map<string, { cells: Cell[]; acres: number; irrigated: boolean; field: string }[]>()
  const { kept, left } = insurableAreas(b, ins)
  let noDate = 0
  for (const { area: a, field: f, irrigated, seeded } of kept) {
    if (!seeded) noDate++
    const list = byCrop.get(a.crop) ?? []
    list.push({ field: f.name, acres: a.acres ?? 0, irrigated, cells: [a.variety, f.name, f.legal_land_description, a.acres, seeded, irrigated ? 'Irrigated' : 'Dryland'] })
    byCrop.set(a.crop, list)
  }
  let acres = 0
  let irrigatedAcres = 0
  const groups: ReportGroup[] = [...byCrop.entries()]
    .sort((x, y) => x[0].localeCompare(y[0]))
    .map(([crop, rows]) => {
      rows.sort((x, y) => compareFieldNames(x.field, y.field))
      const total = rows.reduce((s, r) => s + r.acres, 0)
      const irr = rows.filter((r) => r.irrigated).reduce((s, r) => s + r.acres, 0)
      acres += total
      irrigatedAcres += irr
      const ac = (n: number) => `${n.toLocaleString('en-CA', { maximumFractionDigits: 1 })} ac`
      return {
        title: crop,
        note: `${rows.length} field${rows.length === 1 ? '' : 's'} · ${ac(irr)} irrigated, ${ac(total - irr)} dryland`,
        rows: rows.map((r) => r.cells),
        totals: [`${crop} total`, null, null, total, null, null],
      }
    })
  return { groups, acres, irrigatedAcres, left, noDate }
}

export async function gatherSeededAcreage(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const party = p.insured ?? ''
  const [basics, ins] = await Promise.all([loadSeasonBasics(year), loadInsuranceContext(year, party)])
  const r = acreageGroups(basics, ins)
  if (!r.groups.length) throw new Error(party ? `Nothing is seeded on the joint venture with ${party} for ${year}.` : `No crop is planned on an active field for ${year}.`)
  const ac = (n: number) => `${n.toLocaleString('en-CA', { maximumFractionDigits: 1 })} ac`
  const summary = [
    'Every crop seeded this year with its legal land and acres, grouped by crop the way the AFSC Seeded Acreage Report adds them up. Acres are the crop plan’s (a split field’s areas where it is split on the map); the seeding date is the field’s planting date, from John Deere unless it was corrected by hand.',
  ]
  if (r.noDate) summary.push(`${r.noDate} row${r.noDate === 1 ? ' has' : 's have'} no seeding date: no Deere seeding pass and no planting date on the field’s season.`)
  if (r.left.length) summary.push(`Not on this report: ${r.left.join('; ')}.`)
  return {
    title: 'Seeded acreage report',
    subtitle: `Crop year ${year} · ${partyLabel(party)} · for AFSC`,
    meta: [
      ['Crops', r.groups.length],
      ['Seeded acres', ac(r.acres)],
      ['Irrigated', ac(r.irrigatedAcres)],
      ['Dryland', ac(r.acres - r.irrigatedAcres)],
    ],
    summary,
    columns: AFSC_COLUMNS,
    groups: r.groups,
    groupLabel: 'Crop',
    totals: ['All crops', null, null, r.acres, null, null],
    filename: `Seeded acreage ${year}${party ? ` ${party} JV` : ''}`,
  }
}
