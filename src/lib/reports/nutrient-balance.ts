import { supabase } from '@/lib/supabase'
import { compareFieldNames } from '@/lib/queries'
import { profileTotals, topsoilAverage, type SoilSampleRow } from '@/lib/soilTests'
import { cropRemoval } from '@/lib/fert-savings/tools'
import { fetchAll, fieldLabel, num, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'
import { loadSeasonBasics, yieldText, type CropArea, type HistoryLite, type SeasonCrop } from './field-season'
import { fieldFertility, loadFertility, type FertilityData, type Nutrients } from './nutrients'

/**
 * Per field: what the soil test said was there, what went on (machines,
 * the retailer's floated blends, manure credit — see nutrients.ts), what the
 * crop carried off at its yield, and the difference. A positive balance is
 * left in the field for next year (or lost); a negative one is mined out of
 * the soil, which the next soil test should show.
 *
 * Removal is per unit of yield from the fertilizer research tables
 * (fert-savings/agronomy.ts). The yield is the one recorded for the field;
 * where none is yet, the plan's expected yield stands in and the section
 * says so.
 */

export const BALANCE_COLUMNS = [
  { label: 'Nutrient' },
  { label: 'Soil test' },
  { label: 'Machines', decimals: 0 },
  { label: 'Retailer', decimals: 0 },
  { label: 'Manure', decimals: 0 },
  { label: 'Applied', decimals: 0 },
  { label: 'Removed', decimals: 0 },
  { label: 'Balance', decimals: 0 },
]

export type SoilReportLite = { id: string; field_id: string; crop_year: number; report_date: string | null; lab: string | null }

export type FieldSoilTest = { year: number; lab: string | null; no3nLbAc: number | null; olsenP: number | null; kPpm: number | null; so4sTop: number | null }

/**
 * The newest soil test on each field up to the crop year. A field sampled in
 * halves has two reports that year; their sites are pooled, which is the
 * field-level figure (the history chart reads them the same way).
 */
export function latestSoilTests(reports: SoilReportLite[], samples: Pick<SoilSampleRow, 'report_id' | 'sample_code' | 'depth_top_in' | 'no3n_lb_ac' | 'p_bicarb_ppm' | 'k_ppm' | 'so4s_ppm'>[], year: number): Map<string, FieldSoilTest> {
  const newest = new Map<string, number>()
  for (const r of reports) if (r.crop_year <= year && r.crop_year > (newest.get(r.field_id) ?? 0)) newest.set(r.field_id, r.crop_year)
  const out = new Map<string, FieldSoilTest>()
  for (const [fieldId, y] of newest) {
    const mine = reports.filter((r) => r.field_id === fieldId && r.crop_year === y)
    const ids = new Set(mine.map((r) => r.id))
    const rows = samples.filter((s) => ids.has(s.report_id)).map((s) => ({ ...s, no3n_lb_ac: num(s.no3n_lb_ac), p_bicarb_ppm: num(s.p_bicarb_ppm), k_ppm: num(s.k_ppm), so4s_ppm: num(s.so4s_ppm), depth_top_in: num(s.depth_top_in) })) as SoilSampleRow[]
    const totals = profileTotals(rows)
    out.set(fieldId, {
      year: y,
      lab: mine.map((r) => r.lab).find(Boolean) ?? null,
      no3nLbAc: totals.avgNo3nLbAc,
      olsenP: topsoilAverage(rows, 'p_bicarb_ppm'),
      kPpm: topsoilAverage(rows, 'k_ppm'),
      so4sTop: totals.so4sTopPpm,
    })
  }
  return out
}

const r0 = (v: number | null) => (v == null ? null : Math.round(v) || 0)

export type BalanceInputs = {
  fieldId: string
  year: number
  areas: CropArea[]
  crops: SeasonCrop[]
  fieldAcres: number
  history: HistoryLite[]
  soil: FieldSoilTest | null
  fertility: FertilityData
}

/** The crop a field's balance is drawn against: its largest area of our own crop. */
export function mainArea(areas: CropArea[]): CropArea | null {
  const ours = areas.filter((a) => !a.renters && a.seeded)
  const pool = ours.length ? ours : areas
  return [...pool].sort((a, b) => (b.acres ?? 0) - (a.acres ?? 0))[0] ?? null
}

/** One field's four rows (N, P2O5, K2O, S) and the note that heads them. */
export function balanceGroup(d: BalanceInputs): { rows: Cell[][]; note: string; expected: boolean; noRemoval: boolean; unread: string[] } {
  const area = mainArea(d.areas)
  const crop = area ? d.crops.find((c) => c.id === area.cropId) : null
  const actual = d.history.find((h) => h.field_id === d.fieldId && h.crop_id === area?.cropId && num(h.yield_per_acre) != null)
  const yieldValue = actual ? num(actual.yield_per_acre) : (area?.expectedYield ?? null)
  const yieldUnit = actual?.yield_unit ?? crop?.yield_unit ?? null
  const removed = area ? cropRemoval(area.crop, yieldValue, yieldUnit) : null
  const fert = fieldFertility(d.fieldId, d.year, d.fertility, d.fieldAcres || null)
  const s = d.soil
  const keys: { key: keyof Nutrients; label: string; soil: string | null }[] = [
    { key: 'n', label: 'N', soil: s?.no3nLbAc != null ? `${Math.round(s.no3nLbAc)} lb/ac nitrate-N` : null },
    { key: 'p2o5', label: 'P2O5', soil: s?.olsenP != null ? `Olsen P ${Math.round(s.olsenP)} ppm` : null },
    { key: 'k2o', label: 'K2O', soil: s?.kPpm != null ? `K ${Math.round(s.kPpm)} ppm` : null },
    { key: 's', label: 'S', soil: s?.so4sTop != null ? `SO4-S ${Math.round(s.so4sTop)} ppm (top 6 in)` : null },
  ]
  const rows = keys.map(({ key, label, soil }) => {
    const applied = fert.total[key]
    const off = removed ? removed[key] : null
    return [label, soil, r0(fert.bySource.machine[key]), r0(fert.bySource.retailer[key]), r0(fert.bySource.manure[key]), r0(applied), r0(off), off == null ? null : Math.round(applied - off) || 0]
  })
  const note = [
    area ? `${area.crop}${area.acres != null ? `, ${area.acres.toLocaleString('en-CA', { maximumFractionDigits: 1 })} ac` : ''}` : 'No crop planned',
    yieldValue != null ? `${actual ? 'yield' : 'expected yield'} ${yieldText(yieldValue, yieldUnit)}` : 'no yield',
    s ? `soil test ${s.year}${s.lab ? ` (${s.lab})` : ''}` : 'no soil test on file',
  ].join(' · ')
  return { rows, note, expected: !actual && yieldValue != null, noRemoval: !removed, unread: fert.lines.filter((l) => !l.nutrients).map((l) => l.product) }
}

export async function gatherNutrientBalance(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const [basics, fertility, reports, samples] = await Promise.all([
    loadSeasonBasics(year),
    loadFertility(year, null),
    fetchAll<SoilReportLite>((a, b) => supabase.from('soil_test_reports').select('id, field_id, crop_year, report_date, lab').lte('crop_year', year).order('id').range(a, b)),
    fetchAll<Pick<SoilSampleRow, 'report_id' | 'sample_code' | 'depth_top_in' | 'no3n_lb_ac' | 'p_bicarb_ppm' | 'k_ppm' | 'so4s_ppm'>>((a, b) =>
      supabase.from('soil_test_samples').select('report_id, sample_code, depth_top_in, no3n_lb_ac, p_bicarb_ppm, k_ppm, so4s_ppm').order('id').range(a, b),
    ),
  ])
  const soil = latestSoilTests(reports, samples, year)
  const fieldById = new Map(basics.fields.map((f) => [f.id, f]))
  const farmed = (id: string) => fieldById.get(id)?.active && !basics.rentedOut.has(id)
  // A field growing only the renter's crop was fertilized by the renter, out
  // of sight of every record here; its balance would be all removal.
  const ids = [...new Set(basics.areas.filter((a) => !a.renters).map((a) => a.fieldId))].filter(farmed)
  const renters = [...new Set(basics.areas.map((a) => a.fieldId))].filter((id) => farmed(id) && !ids.includes(id))
  ids.sort((a, b) => compareFieldNames(fieldById.get(a)!.name, fieldById.get(b)!.name))

  const groups: ReportGroup[] = []
  let expected = 0
  const noRemoval = new Set<string>()
  let noSoil = 0
  const unread = new Set<string>()
  for (const id of ids) {
    const areas = basics.areas.filter((a) => a.fieldId === id)
    const g = balanceGroup({ fieldId: id, year, areas, crops: basics.crops, fieldAcres: basics.acresOf.get(id) ?? 0, history: basics.history, soil: soil.get(id) ?? null, fertility })
    if (g.expected) expected++
    if (g.noRemoval) noRemoval.add(mainArea(areas)?.crop ?? 'no crop')
    if (!soil.has(id)) noSoil++
    g.unread.forEach((n) => unread.add(n))
    groups.push({ title: fieldLabel(fieldById.get(id)!.name), note: g.note, rows: g.rows })
  }
  if (!groups.length) throw new Error(`No field has a crop planned for ${year}.`)

  const summary = [
    'Per field, lb/ac: the newest soil test up to this year, what went on (the machines’ records, the retailer’s floated blends, manure credit to this crop), what the crop carries off at its yield, and applied less removed. A negative balance is being mined from the soil.',
  ]
  if (expected) summary.push(`${expected} field${expected === 1 ? ' has' : 's have'} no yield recorded yet, so removal is at the plan’s expected yield.`)
  if (noRemoval.size) summary.push(`No removal figures for ${[...noRemoval].sort().join(', ')}: the balance is left blank there.`)
  if (renters.length) summary.push(`Growing only the renter’s crop, so left out: ${renters.map((id) => fieldById.get(id)!.name).sort(compareFieldNames).map(fieldLabel).join(', ')}.`)
  if (noSoil) summary.push(`${noSoil} field${noSoil === 1 ? ' has' : 's have'} no soil test on file.`)
  if (unread.size) summary.push(`Logged by volume, with no analysis to turn into pounds, so not counted: ${[...unread].sort().join(', ')}.`)
  return {
    title: 'Nutrient balance by field',
    subtitle: `Crop year ${year}`,
    meta: [
      ['Fields', groups.length],
      ['With a soil test', groups.length - noSoil],
      ['At expected yield', expected],
    ],
    summary,
    columns: BALANCE_COLUMNS,
    groups,
    groupLabel: 'Field',
    filename: `Nutrient balance ${year}`,
  }
}
