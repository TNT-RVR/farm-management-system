import { supabase } from '@/lib/supabase'
import { compareFieldNames } from '@/lib/queries'
import { productResolver, type PriceBookAlias, type PriceBookProduct, type ResolvedProduct } from '@/lib/spray-products'
import { balanceTotals, pickBalance, type ReviewBalanceRow } from '@/lib/water-review'
import { fetchAll, fieldLabel, num, pick, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'
import { fertilizerOnly, sprayRows, type SprayOp } from './spray'
import { inches, loadSeasonBasics, yieldText, type CropArea, type DayFrom, type HistoryLite, type SeasonCrop } from './field-season'
import { fieldFertility, loadFertility, type FertilityData, type FertSource } from './nutrients'

/**
 * A field's season on one page: what was grown and when it went in, every
 * product sprayed with its rate, the fertility it got from every source, the
 * water it was given and the rain it had, hail, and when it came off and
 * what it yielded. The record a buyer, a lender or next year's agronomist
 * wants for a field, made from what the app already holds.
 *
 * Sprays are the spray records' own lines (same rate, same PCP number);
 * fertility is the nutrient balance's (machine passes, the retailer's floated
 * blends, manure credit). A product tank-mixed into a spray that is itself a
 * fertilizer is listed once, as fertility, where its nutrients are counted.
 */

export const SEASON_COLUMNS = [
  { label: 'Date' },
  { label: 'Activity' },
  { label: 'Product / detail' },
  { label: 'PCP no.' },
  { label: 'Rate', upTo: 3 },
  { label: 'Rate unit' },
  { label: 'Total' },
  { label: 'N', decimals: 0 },
  { label: 'P2O5', decimals: 0 },
  { label: 'K2O', decimals: 0 },
  { label: 'S', decimals: 0 },
  { label: 'Note' },
]

const FERT_ACTIVITY: Record<FertSource, string> = { machine: 'Fertilizer', retailer: 'Fertilizer (retailer)', manure: 'Manure' }

export type SeasonInputs = {
  fieldId: string
  year: number
  areas: CropArea[]
  crops: SeasonCrop[]
  fieldAcres: number
  irrigated: boolean
  seeded: DayFrom | null
  harvested: DayFrom | null
  history: HistoryLite[]
  sprays: SprayOp[]
  resolve: (deereName: string) => ResolvedProduct | undefined
  fertility: FertilityData
  irrigation: { date: string; gross_mm: unknown; net_mm: unknown }[]
  balance: ReviewBalanceRow[]
  hail: { event_date: string; notes: string | null }[]
}

const blank = (n: number): Cell[] => Array.from({ length: n }, () => null)
const row = (date: string | null, activity: string, detail: Cell, rest: Partial<{ pcp: Cell; rate: Cell; unit: Cell; total: Cell; n: Cell; p: Cell; k: Cell; s: Cell; note: Cell }> = {}): Cell[] => [
  date,
  activity,
  detail,
  rest.pcp ?? null,
  rest.rate ?? null,
  rest.unit ?? null,
  rest.total ?? null,
  rest.n ?? null,
  rest.p ?? null,
  rest.k ?? null,
  rest.s ?? null,
  rest.note ?? null,
]

/** One field's season as report rows, oldest first, with its note and its fertility totals. */
export function seasonGroup(d: SeasonInputs): { note: string; rows: Cell[][]; totals: Cell[]; sprayLines: number; unmatched: Set<string> } {
  const dated: { at: string; order: number; cells: Cell[] }[] = []
  const push = (at: string | null, order: number, cells: Cell[]) => dated.push({ at: at ?? '9999', order, cells })

  const ours = d.areas.filter((a) => !a.renters)
  const cropWords = d.areas.map((a) => `${a.crop}${a.variety ? ` (${a.variety})` : ''}${a.acres != null ? ` ${a.acres.toLocaleString('en-CA', { maximumFractionDigits: 1 })} ac` : ''}${a.renters ? ', the renter’s' : ''}`)

  const sown = ours.length ? ours : d.areas
  if (d.seeded) push(d.seeded.date, 0, row(d.seeded.date, 'Seeded', sown.map((a) => (a.variety ? `${a.crop}, ${a.variety}` : a.crop)).join('; ') || null, { note: `date: ${d.seeded.from}` }))

  const spray = sprayRows(
    d.sprays.filter((o) => o.field_id === d.fieldId && !fertilizerOnly(o.products)),
    d.fieldAcres,
    d.resolve,
  )
  let sprayLines = 0
  for (const s of spray.rows) {
    // A fertilizer in the tank is in the fertility lines, with its nutrients.
    if (s[4] === 'fertilizer') continue
    sprayLines++
    // Deere's "---" is a pass logged with its product slot left empty.
    const product = /^-+$/.test(String(s[2] ?? '').trim()) ? 'product not named in Deere' : s[2]
    push(String(s[0] ?? ''), 1, row(s[0] as string | null, 'Sprayed', product, { pcp: s[3], rate: s[5], unit: s[6], total: s[8], note: [s[4], s[9]].filter(Boolean).join(' · ') || null }))
  }

  const fert = fieldFertility(d.fieldId, d.year, d.fertility, d.fieldAcres || null)
  for (const l of fert.lines) {
    push(l.date, 2, row(l.date, FERT_ACTIVITY[l.source], l.product, { rate: l.rate, unit: l.unit, total: l.total, n: l.nutrients?.n ?? null, p: l.nutrients?.p2o5 ?? null, k: l.nutrients?.k2o ?? null, s: l.nutrients?.s ?? null, note: l.note }))
  }

  for (const h of d.hail) push(h.event_date, 3, row(h.event_date, 'Hail', h.notes ?? 'marked on the field'))

  const irrigationMm = d.irrigation.reduce((s, e) => s + (num(e.gross_mm) ?? num(e.net_mm) ?? 0), 0)
  const rain = balanceTotals(pickBalance(d.balance))
  const tail: Cell[][] = []
  if (d.irrigation.length) {
    const days = [...new Set(d.irrigation.map((e) => e.date))].sort()
    tail.push(row(null, 'Irrigation', `${days.length} day${days.length === 1 ? '' : 's'} watered, ${days[0]} to ${days[days.length - 1]}`, { total: inches(irrigationMm), note: 'gross, as the pivot logged it' }))
  }
  if (rain.days) tail.push(row(null, 'Rain', `${rain.days} days in the water balance`, { total: inches(rain.rainMm) }))

  if (d.harvested) push(d.harvested.date, 4, row(d.harvested.date, 'Harvest began', null, { note: `date: ${d.harvested.from}` }))
  const cropName = new Map(d.crops.map((c) => [c.id, c.name]))
  const yields = d.history.filter((h) => h.field_id === d.fieldId && num(h.yield_per_acre) != null)
  for (const h of yields) {
    tail.push(row(null, 'Yield', h.crop_id ? (cropName.get(h.crop_id) ?? null) : null, { total: yieldText(num(h.yield_per_acre), h.yield_unit), note: h.source === 'scale' ? 'from the loads weighed' : (h.source?.replace(/_/g, ' ') ?? null) }))
  }

  dated.sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order)
  const note = [
    cropWords.join(' + ') || 'No crop planned',
    d.irrigated ? 'irrigated' : 'dryland',
    d.seeded ? `seeded ${d.seeded.date}` : 'no seeding date',
    d.irrigation.length || rain.days ? `${inches(irrigationMm)} irrigation, ${inches(rain.rainMm)} rain` : null,
    yields.length ? `yield ${yields.map((h) => yieldText(num(h.yield_per_acre), h.yield_unit)).join(', ')}` : 'no yield yet',
  ]
    .filter(Boolean)
    .join(' · ')
  const t = fert.total
  return {
    note,
    rows: [...dated.map((x) => x.cells), ...tail],
    totals: ['Season', 'Nutrients, lb/ac', ...blank(5), t.n, t.p2o5, t.k2o, t.s, null],
    sprayLines,
    unmatched: spray.unmatched,
  }
}

export async function gatherFieldSeason(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const fieldId = pick(p, 'field')
  const [basics, sprays, products, aliases, fertility, irrigation, balance, hail] = await Promise.all([
    loadSeasonBasics(year),
    fetchAll<SprayOp & { not_ours: string | null }>((a, b) => {
      let q = supabase
        .from('jd_field_operations')
        .select('id, field_id, jd_id, started_at, ended_at, operator_name, treated_crop, products, raw, applied_area_ha, as_applied, sessions, cost_acres_override, not_ours')
        .eq('operation_type', 'application')
        .eq('crop_season', year)
        .is('duplicate_of', null)
        .is('not_ours', null)
        .or('confirm_status.is.null,confirm_status.eq.confirmed')
        .order('id')
      if (fieldId) q = q.eq('field_id', fieldId)
      return q.range(a, b)
    }),
    fetchAll<PriceBookProduct>((a, b) => supabase.from('jd_products').select('id, name, pmra_registration').order('id').range(a, b)),
    fetchAll<PriceBookAlias>((a, b) => supabase.from('jd_product_aliases').select('deere_name, product_id, ignored').order('deere_name').range(a, b)),
    loadFertility(year, fieldId),
    fetchAll<{ field_id: string; date: string; gross_mm: unknown; net_mm: unknown }>((a, b) => {
      let q = supabase.from('irrigation_events').select('field_id, date, gross_mm, net_mm').gte('date', `${year}-01-01`).lte('date', `${year}-12-31`).order('id')
      if (fieldId) q = q.eq('field_id', fieldId)
      return q.range(a, b)
    }),
    fetchAll<ReviewBalanceRow>((a, b) => {
      let q = supabase
        .from('water_balance_daily')
        .select('field_id, zone_id, date, is_forecast, rainfall_mm, etc_mm, status, ks, dr_mm, raw_mm')
        .eq('is_forecast', false)
        .gte('date', `${year}-01-01`)
        .lte('date', `${year}-12-31`)
        .order('field_id')
        .order('date')
        .order('zone_id')
      if (fieldId) q = q.eq('field_id', fieldId)
      return q.range(a, b)
    }),
    fetchAll<{ field_id: string; event_date: string; notes: string | null }>((a, b) => supabase.from('field_hail_events').select('field_id, event_date, notes').eq('crop_year', year).order('id').range(a, b)),
  ])

  const resolve = productResolver(products, aliases)
  const fieldById = new Map(basics.fields.map((f) => [f.id, f]))
  // The fields with a crop on them this year, or anything done to them.
  const touched = new Set([...basics.areas.map((a) => a.fieldId), ...sprays.map((o) => o.field_id ?? ''), ...fertility.ops.map((o) => o.field_id ?? ''), ...irrigation.map((e) => e.field_id)])
  const ids = [...touched].filter((id) => {
    const f = fieldById.get(id)
    if (!f) return false
    if (fieldId) return id === fieldId
    return f.active && !basics.rentedOut.has(id)
  })
  ids.sort((a, b) => compareFieldNames(fieldById.get(a)!.name, fieldById.get(b)!.name))

  const groups: ReportGroup[] = []
  const unmatched = new Set<string>()
  let sprayLines = 0
  for (const id of ids) {
    const g = seasonGroup({
      fieldId: id,
      year,
      areas: basics.areas.filter((a) => a.fieldId === id),
      crops: basics.crops,
      fieldAcres: basics.acresOf.get(id) ?? 0,
      irrigated: basics.irrigated.has(id),
      seeded: basics.seeded.get(id) ?? null,
      harvested: basics.harvested.get(id) ?? null,
      history: basics.history,
      sprays,
      resolve,
      fertility,
      irrigation: irrigation.filter((e) => e.field_id === id),
      balance: balance.filter((r) => r.field_id === id),
      hail: hail.filter((h) => h.field_id === id),
    })
    g.unmatched.forEach((n) => unmatched.add(n))
    sprayLines += g.sprayLines
    groups.push({ title: fieldLabel(fieldById.get(id)!.name), note: g.note, rows: g.rows, totals: g.totals })
  }
  if (!groups.length) throw new Error(fieldId ? `Nothing is recorded on that field for ${year}.` : `No field has a crop or a pass recorded for ${year}.`)

  const which = fieldId ? fieldLabel(fieldById.get(fieldId)?.name ?? 'One field') : 'All fields'
  const summary = [
    'One field to a section: the crop and when it went in, every product sprayed (rate as set in the display, total over the acres the pass covered), fertility from the machines’ records, the retailer’s floated blends and manure credit, water and rain, hail, harvest and yield.',
    'Nutrients are lb/ac over the whole field. Irrigation is the gross the pivot logged; rain is the field’s water balance.',
  ]
  // Deere's "---" is an empty product slot, not a product to match.
  const named = [...unmatched].filter((n) => !/^-+$/.test(n.trim())).sort()
  if (named.length) summary.push(`Not matched to the price book, so no PCP number: ${named.join(', ')}.`)
  if (!fieldId && basics.rentedOut.size) summary.push(`Rented out for the year, so left out: ${[...basics.rentedOut.keys()].map((k) => fieldLabel(fieldById.get(k)?.name ?? 'a field')).join(', ')}.`)
  return {
    title: 'Field season summary',
    subtitle: `Crop year ${year} · ${which}`,
    meta: [
      ['Fields', groups.length],
      ['Spray lines', sprayLines],
      ['Irrigated fields', ids.filter((id) => basics.irrigated.has(id)).length],
      ['Harvest started', ids.filter((id) => basics.harvested.has(id)).length],
    ],
    summary,
    columns: SEASON_COLUMNS,
    groups,
    groupLabel: 'Field',
    orientation: 'landscape',
    filename: `Field season summary ${year} ${which}`,
  }
}
