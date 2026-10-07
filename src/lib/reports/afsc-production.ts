import { supabase } from '@/lib/supabase'
import { compareFieldNames } from '@/lib/queries'
import { bushelWeightFor, convertMass, type MassUnit } from '@/lib/bushels'
import { netInUnit } from '@/lib/scale-tickets'
import { dealFor, type LandDeal } from '@/lib/land-deals'
import type { ReportSection } from '@/lib/table-report'
import { fetchAll, fieldLabel, num, yearParam, type Cell, type GatherContext, type ParamValues, type SectionedReport } from './framework'
import { insurableAreas, loadInsuranceContext, partyLabel, type InsurableArea } from './afsc'
import { loadSeasonBasics, type DayFrom } from './field-season'
import { binLines, type Movement } from './grain-inventory'
import type { HailMark, Inspection } from './hail'

/**
 * AFSC's Harvested Production Report (HPR), laid out to copy from.
 *
 * Every AgriInsurance client declares the year's insured production on an
 * HPR once harvest is done: online through AFSC Connect, or by email, mail,
 * fax or at a branch. Annual crops are due 15 November, perennials (hay)
 * 15 October; late reports are taken to 31 December with a fee, and after
 * that the yield is recorded as zero. Unharvested acres are reported on the
 * HPR by 15 November too (last day 31 December). AFSC's form is online, so
 * this is a worksheet in the same order: per crop, irrigated and dryland
 * apart (AFSC insures and wants them stored and reported separately), then
 * per field; and where the production went — stored, fed, sold.
 *
 * Sources, read 3 October 2026 (docs/afsc-production-report.md has the detail):
 *   https://afsc.ca/crop-insurance/harvested-production-report/
 *   https://afsc.ca/faq/  (What is the Harvested Production Report? How do I file it?)
 *   https://afsc.ca/news/options-exist-for-farmers-facing-potential-unharvested-acres/
 *   https://afsc.ca/wp-content/uploads/2026/03/2026-Cereal-and-Oilseeds-Insuring-Agreement.pdf
 *     (2.05 irrigation coverage, 5.01 insured acres, 8.01 claim deadlines,
 *      9.01 carryover, 10.01 what the HPR asks for, 10.08 prorating)
 *
 * This is a declaration to the insurer, so it states only what was weighed
 * or written down: a field with no recorded harvest says so and never shows
 * the plan's expected yield, and anything the app does not hold (grade,
 * fed, the AFSC client and contract numbers) is blank with what to fill in.
 *
 * The acres are the seeded acreage report's (afsc.ts insurableAreas), so the
 * two reports list the same fields. The grower's potatoes (a land deal
 * turned round: our land, their crop and inputs) and a renter's crop are
 * theirs to insure and are left off, named at the end. A 50/50 field is
 * shown whole, with our share beside it, flagged to confirm with AFSC.
 */

/* ── Units ─────────────────────────────────────────────────────────────── */

/** A crop's yield unit as the unit converter's: tons are short tons, MT tonnes. Null for a unit that is not a weight. */
export function massUnitOf(unit: string | null | undefined): MassUnit | null {
  switch ((unit ?? 'bu').toLowerCase()) {
    case 'bu':
      return 'bu'
    case 'lbs':
    case 'lb':
      return 'lb'
    case 'cwt':
      return 'cwt'
    case 'ton':
      return 'ston'
    case 'mt':
    case 't':
    case 'tonne':
      return 't'
    default:
      return null
  }
}

/** The word a production figure is printed with. */
export const unitWord = (unit: string | null | undefined) => {
  const u = (unit ?? 'bu').toLowerCase()
  return u === 'lbs' || u === 'lb' ? 'lb' : u === 'mt' ? 'tonnes' : u === 'ton' ? 'tons' : u
}

export type LoadLite = {
  id: string
  field_id: string | null
  crop_id: string
  bin_id: string | null
  delivery_site_id: string | null
  loaded_on: string
  gross_kg: unknown
  tare_kg: unknown
  net_kg: unknown
  bushels: unknown
  lb_per_bu: unknown
  last_from_field: boolean
}

/**
 * A load in the crop's unit: bushels as the scale worked them (at the load's
 * own bushel weight), anything else from the net kilograms. Null where it
 * cannot be known (no weight, or a unit that is not a weight).
 */
export function loadInUnit(l: Pick<LoadLite, 'net_kg' | 'bushels' | 'lb_per_bu'>, unit: string | null): number | null {
  const to = massUnitOf(unit)
  if (to === 'bu') {
    const bu = num(l.bushels)
    if (bu != null) return bu
  }
  const kg = num(l.net_kg)
  if (kg == null || to == null) return null
  return convertMass(kg, 'kg', to, num(l.lb_per_bu))
}

/** An amount in the crop's unit as tonnes, at the crop's bushel weight for bushels. */
export function toTonnes(v: number | null, unit: string | null, lbPerBu: number | null): number | null {
  const from = massUnitOf(unit)
  if (v == null || from == null) return null
  return convertMass(v, from, 't', lbPerBu)
}

/** Bushels off the grain ledger in the crop's unit (pounds for beans). */
export function bushelsInUnit(bu: number, unit: string | null, lbPerBu: number | null): number | null {
  const to = massUnitOf(unit)
  return to == null ? null : convertMass(bu, 'bu', to, lbPerBu)
}

/* ── Shares ────────────────────────────────────────────────────────────── */

export type Share = {
  /** Our part of the crop, 0..1. */
  fraction: number
  /** Whose land deal, for the flag; null on our own or cash-rented land. */
  with: string | null
  /** Our land, somebody else's crop and inputs: theirs to insure. */
  theirs: boolean
}

/**
 * Our part of a field's crop under its land deal. A 50/50 field (the owner
 * takes half the gross) is half ours; a crop share is what the owner does
 * not take; cash rent and our own land are all ours. A deal turned round
 * (the potato grower on our land) is the grower's crop.
 */
export function shareOf(deal: LandDeal | null): Share {
  if (!deal) return { fraction: 1, with: null, theirs: false }
  if (deal.direction === 'out') return { fraction: 0, with: deal.landlord, theirs: deal.arrangement !== 'cash_rent' }
  if (deal.arrangement === 'profit_share') return { fraction: (num(deal.our_share_pct) ?? 50) / 100, with: deal.landlord, theirs: false }
  if (deal.arrangement === 'crop_share') return { fraction: 1 - (num(deal.crop_share_pct) ?? 0) / 100, with: deal.landlord, theirs: false }
  return { fraction: 1, with: null, theirs: false }
}

/* ── A field's harvest ─────────────────────────────────────────────────── */

export type HistoryRow = {
  field_id: string
  crop_id: string
  acres: unknown
  yield_per_acre: unknown
  yield_unit: string | null
  actual_yield_total: unknown
  source: string | null
  scale_acres: unknown
  scale_at: string | null
}

export type HarvestStatus = 'harvested' | 'under_way' | 'no_production' | 'not_harvested'

export const STATUS_TEXT: Record<HarvestStatus, string> = {
  harvested: 'Harvested',
  under_way: 'Harvest not finished',
  no_production: 'Harvested, production not recorded',
  not_harvested: 'Not harvested yet',
}

export type FieldHarvest = {
  status: HarvestStatus
  /** The declared production in `unit`; null unless harvested. */
  production: number | null
  unit: string
  acres: number | null
  yieldPerAcre: number | null
  /** The day harvest finished: the last load off the field. */
  completed: string | null
  /** Where the figure came from, in words. */
  source: string | null
  /** Weighed so far on a field still going; never declared. */
  soFar: number | null
  loads: number
}

const SOURCE_WORDS: Record<string, string> = {
  scale: 'scale loads',
  manual: 'entered by hand',
  jd_import: 'John Deere yield',
  fah_import: 'Farm at Hand',
  rotation_xlsx: 'rotation workbook',
}

const isComplete = (l: Pick<LoadLite, 'gross_kg' | 'tare_kg'>) => num(l.gross_kg) != null && num(l.tare_kg) != null

/**
 * Where one crop area stands: harvested with a figure (crop history's, as
 * the last load or a person wrote it), under way (loads weighed, the last
 * not marked), harvested with nothing recorded (a Deere harvest pass or a
 * harvest date, no weights), or not harvested yet. Only the first carries
 * production; the plan's expected yield is never used.
 */
export function fieldHarvest(i: { history: HistoryRow | null; loads: LoadLite[]; unit: string | null; began: DayFrom | null }): FieldHarvest {
  const loads = i.loads.filter(isComplete)
  const unit = i.history?.yield_unit ?? i.unit ?? 'bu'
  const last = loads.filter((l) => l.last_from_field).sort((a, b) => b.loaded_on.localeCompare(a.loaded_on))[0]
  const h = i.history
  const acres = h ? (num(h.scale_acres) ?? num(h.acres)) : null
  const perAcre = h ? num(h.yield_per_acre) : null
  const total = h ? (num(h.actual_yield_total) ?? (perAcre != null && acres != null ? perAcre * acres : null)) : null
  const base = { unit, loads: loads.length, soFar: null, completed: null, source: null, acres: null, yieldPerAcre: null, production: null }
  if (total != null && total > 0) {
    return {
      ...base,
      status: 'harvested',
      production: total,
      acres,
      yieldPerAcre: perAcre ?? (acres ? total / acres : null),
      completed: last?.loaded_on ?? null,
      source: SOURCE_WORDS[h?.source ?? ''] ?? h?.source ?? null,
    }
  }
  if (loads.length) {
    const sum = loads.reduce((s, l) => s + (loadInUnit(l, unit) ?? 0), 0)
    return { ...base, unit, status: 'under_way', soFar: sum }
  }
  if (i.began) return { ...base, status: 'no_production' }
  return { ...base, status: 'not_harvested' }
}

/* ── The report ─────────────────────────────────────────────────────────── */

export type ProdCrop = { id: string; name: string; yield_unit: string | null; test_weight_lb_per_bu: unknown; own_use: boolean | null }
export type ProdTicket = { crop_id: string | null; ticket_no: string | null; net_lb: unknown; net_units: unknown; unit: string | null; dockage_pct: unknown; bin_load_id: string | null }
export type ProdMove = Movement & { ticket_number: string | null }

export type ProductionInput = {
  year: number
  /** '' for the farm's own report, else the joint venture's landlord. */
  party?: string
  today: string
  areas: InsurableArea[]
  /** Left off the seeded acreage report, with why. */
  left: string[]
  crops: ProdCrop[]
  history: HistoryRow[]
  loads: LoadLite[]
  moves: ProdMove[]
  tickets: ProdTicket[]
  deals: LandDeal[]
  began: Map<string, DayFrom>
  hailMarks: HailMark[]
  inspections: Inspection[]
  binName: (id: string) => string | null
  siteName: (id: string) => string | null
}

export const FIELD_HEAD = ['Field', 'Legal land', 'Variety', 'Seeded ac', 'Harvested ac', 'Harvest completed', 'Status', 'Production', 'Unit', 'Tonnes', 'Yield/ac', 'Went to', 'Hail or damage', 'Fill in']
export const CROP_HEAD = ['Crop', 'Land', 'Fields', 'Seeded ac', 'Harvested ac', 'Not harvested yet (ac)', 'Production', 'Unit', 'Tonnes', 'Yield/ac', 'Harvest completed']
export const WENT_HEAD = ['Crop', 'Unit', 'Harvested (declared)', 'Sold or delivered', 'In bins now', 'Shrink', 'Fed', 'Grade', 'Avg dockage (%)', 'Bushel weight (lb)', 'Fill in or check']
export const LINE_HEAD = ['Item', 'Value', 'Status', 'What to fill in']

const r0 = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v))
const r1 = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10)
/** Production to the places its unit wants: whole bushels and pounds, tenths of tons and cwt. */
const prod = (v: number | null, unit: string) => (['bu', 'lbs', 'lb'].includes(unit.toLowerCase()) ? r0(v) : r1(v))
const sumOrNull = (xs: (number | null)[]) => (xs.some((x) => x != null) ? xs.reduce<number>((s, x) => s + (x ?? 0), 0) : null)
const fmt = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: v >= 100 ? 0 : 1 })

/** "Bin 4 (3,200 bu); Viterra Taber (2,503 bu)": where a field's loads went. */
export function wentTo(loads: LoadLite[], unit: string, names: Pick<ProductionInput, 'binName' | 'siteName'>): string | null {
  const by = new Map<string, number>()
  for (const l of loads.filter(isComplete)) {
    const where = l.bin_id ? (names.binName(l.bin_id) ?? 'a bin') : l.delivery_site_id ? (names.siteName(l.delivery_site_id) ?? 'a buyer') : null
    if (!where) continue
    by.set(where, (by.get(where) ?? 0) + (loadInUnit(l, unit) ?? 0))
  }
  if (!by.size) return null
  return [...by.entries()].map(([w, v]) => `${w} (${fmt(v)} ${unitWord(unit)})`).join('; ')
}

/** The hail on a field this year, AFSC's inspections first. */
export function damageText(fieldId: string, marks: HailMark[], inspections: Inspection[]): string | null {
  const live = inspections.filter((i) => i.field_id === fieldId && i.status !== 'rejected')
  const seen = new Set(live.map((i) => i.damage_date))
  const parts = live
    .sort((a, b) => (a.damage_date ?? '').localeCompare(b.damage_date ?? ''))
    .map((i) => {
      const loss = num(i.loss_pct)
      const acres = num(i.acres)
      return `Hail ${i.damage_date ?? '(date?)'}: AFSC ${i.inspection_number}${loss != null ? `, ${loss}% loss` : ''}${acres != null ? ` on ${fmt(acres)} ac` : ''}${i.status === 'pending' ? ' (waiting to be checked on Hail)' : ''}`
    })
  for (const m of marks.filter((x) => x.field_id === fieldId && !seen.has(x.event_date)).sort((a, b) => a.event_date.localeCompare(b.event_date))) parts.push(`Hail ${m.event_date} marked; no AFSC inspection on file`)
  return parts.length ? parts.join('; ') : null
}

type Row = { area: InsurableArea; crop: ProdCrop | null; harvest: FieldHarvest; share: Share; lbPerBu: number | null; cells: Cell[] }

export function productionReport(inp: ProductionInput): SectionedReport & { rows: number } {
  const cropById = new Map(inp.crops.map((c) => [c.id, c]))
  const left = [...inp.left]
  const rows: Row[] = []
  for (const a of inp.areas) {
    const deal = dealFor(inp.deals, a.field.id, inp.year, a.area.cropId)
    const share = shareOf(deal)
    if (deal?.direction === 'out') {
      left.push(`${a.area.crop} on ${fieldLabel(a.field.name)} (${share.theirs ? `${share.with}’s crop and inputs on our land` : `rented out to ${share.with}`})`)
      continue
    }
    const crop = cropById.get(a.area.cropId) ?? null
    const lbPerBu = crop ? (bushelWeightFor(crop.name, num(crop.test_weight_lb_per_bu))?.lbPerBu ?? null) : null
    const history = inp.history.find((h) => h.field_id === a.field.id && h.crop_id === a.area.cropId) ?? null
    const loads = inp.loads.filter((l) => l.field_id === a.field.id && l.crop_id === a.area.cropId)
    const harvest = fieldHarvest({ history, loads, unit: crop?.yield_unit ?? null, began: inp.began.get(a.field.id) ?? null })
    const u = harvest.unit
    const fill: string[] = []
    if (harvest.status === 'harvested') {
      if (!harvest.completed) fill.push('date harvest was completed')
      if (harvest.acres == null) fill.push('harvested acres')
    } else if (harvest.status === 'under_way') fill.push(`harvest not finished: ${fmt(harvest.soFar ?? 0)} ${unitWord(u)} weighed so far over ${harvest.loads} load${harvest.loads === 1 ? '' : 's'}; mark the last load to declare it`)
    else if (harvest.status === 'no_production') fill.push('production, harvested acres and the date harvest was completed')
    else fill.push('if it will not be combined: unharvested acres, the reason and a yield estimate (AFSC assesses them)')
    const production = harvest.status === 'harvested' ? harvest.production : null
    rows.push({
      area: a,
      crop,
      harvest,
      share,
      lbPerBu,
      cells: [
        a.field.name,
        a.field.legal_land_description,
        a.area.variety,
        r1(a.area.acres),
        r1(harvest.acres),
        harvest.completed,
        STATUS_TEXT[harvest.status],
        prod(production, u),
        production != null ? unitWord(u) : null,
        r1(toTonnes(production, u, lbPerBu)),
        r1(harvest.status === 'harvested' ? harvest.yieldPerAcre : null),
        wentTo(loads, u, inp),
        damageText(a.field.id, inp.hailMarks, inp.inspections),
        fill.join('; ') || null,
      ],
    })
  }

  // A crop and its land, irrigated and dryland apart, as AFSC insures them.
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const k = `${r.area.area.crop}|${r.area.irrigated ? 'Irrigated' : 'Dryland'}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  const summaryRows: Cell[][] = []
  const fieldSections: ReportSection[] = []
  for (const [key, list] of ordered) {
    const [cropName, land] = key.split('|')
    list.sort((a, b) => compareFieldNames(a.area.field.name, b.area.field.name))
    const done = list.filter((r) => r.harvest.status === 'harvested')
    const units = [...new Set(done.map((r) => r.harvest.unit))]
    const unit = units.length === 1 ? units[0] : null
    const seeded = sumOrNull(list.map((r) => r.area.area.acres))
    const harvestedAc = sumOrNull(done.map((r) => r.harvest.acres))
    const notYet = list.filter((r) => r.harvest.status !== 'harvested')
    const notYetAc = sumOrNull(notYet.map((r) => r.area.area.acres))
    const production = unit ? sumOrNull(done.map((r) => r.harvest.production)) : null
    const lb = list[0]?.lbPerBu ?? null
    const tonnes = unit ? r1(toTonnes(production, unit, lb)) : null
    const acresWithYield = sumOrNull(done.filter((r) => r.harvest.acres != null).map((r) => r.harvest.acres))
    const yieldAc = unit && acresWithYield ? sumOrNull(done.filter((r) => r.harvest.acres != null).map((r) => r.harvest.production)) : null
    const completed = done.length && !notYet.length && done.every((r) => r.harvest.completed) ? done.map((r) => r.harvest.completed!).sort().at(-1)! : null
    const u = unit ?? 'bu'
    summaryRows.push([cropName, land, list.length, r1(seeded), r1(harvestedAc), r1(notYetAc), prod(production, u), unit ? unitWord(unit) : null, tonnes, r1(yieldAc != null && acresWithYield ? yieldAc / acresWithYield : null), completed])
    const parts = [`${list.length} field${list.length === 1 ? '' : 's'}`, `${done.length} harvested`]
    if (notYet.length) parts.push(`${notYet.length} not declared yet (${fmt(notYetAc ?? 0)} ac)`)
    if (units.length > 1) parts.push(`production is in more than one unit (${units.map(unitWord).join(', ')}), so it is not totalled`)
    fieldSections.push({
      title: `${cropName} · ${land.toLowerCase()}`,
      note: parts.join(' · '),
      head: FIELD_HEAD,
      rows: list.map((r) => r.cells),
      foot: ['Total', null, null, r1(seeded), r1(harvestedAc), completed, null, prod(production, u), unit ? unitWord(unit) : null, tonnes, null, null, null, null],
    })
  }

  // Where each crop's production went, from the ledger and the buyers' tickets.
  const wentRows: Cell[][] = []
  const cropsGrown = [...new Map(rows.map((r) => [r.area.area.cropId, r])).values()].sort((a, b) => a.area.area.crop.localeCompare(b.area.area.crop))
  const settled = new Set(inp.tickets.map((t) => t.bin_load_id).filter(Boolean))
  const ticketNos = new Set(inp.tickets.map((t) => (t.ticket_no ?? '').trim()).filter(Boolean))
  const inBins = binLines(inp.moves, [], inp.today).filter((l) => l.cropYear === inp.year)
  for (const r of cropsGrown) {
    const cropId = r.area.area.cropId
    const crop = r.crop
    const unit = crop?.yield_unit ?? 'bu'
    const lb = r.lbPerBu
    const mine = rows.filter((x) => x.area.area.cropId === cropId)
    const done = mine.filter((x) => x.harvest.status === 'harvested' && x.harvest.unit === unit)
    const declared = sumOrNull(done.map((x) => x.harvest.production))
    const tickets = inp.tickets.filter((t) => t.crop_id === cropId)
    const sold = sumOrNull([
      ...tickets.map((t) => {
        const stated = num(t.net_units)
        return stated != null && t.unit ? netInUnit({ net_lb: num(t.net_lb), net_stated: stated, net_stated_unit: t.unit }, unit, crop?.name) : netInUnit({ net_lb: num(t.net_lb) }, unit, crop?.name)
      }),
      ...inp.loads.filter((l) => l.crop_id === cropId && l.delivery_site_id && isComplete(l) && !settled.has(l.id)).map((l) => loadInUnit(l, unit)),
      ...inp.moves.filter((m) => m.crop_id === cropId && m.crop_year === inp.year && m.movement_type === 'delivery_out' && !(m.ticket_number && ticketNos.has(m.ticket_number.trim()))).map((m) => bushelsInUnit(num(m.bushels) ?? 0, unit, lb)),
    ])
    const binBu = sumOrNull(inBins.filter((l) => l.cropId === cropId).map((l) => l.bu))
    const shrinkBu = sumOrNull(inp.moves.filter((m) => m.crop_id === cropId && m.crop_year === inp.year && m.movement_type === 'shrink').map((m) => num(m.bushels)))
    const dock = tickets.filter((t) => num(t.dockage_pct) != null)
    const dockW = dock.reduce((s, t) => s + (num(t.net_lb) ?? 1), 0)
    const avgDock = dock.length ? dock.reduce((s, t) => s + num(t.dockage_pct)! * (num(t.net_lb) ?? 1), 0) / dockW : null
    const notes: string[] = []
    const lands = new Set(mine.map((x) => x.area.irrigated))
    if (lands.size > 1) notes.push('irrigated and dryland share the bins in the app; AFSC wants them stored and reported apart')
    if (crop?.own_use) notes.push('a feed crop: fill in what was fed')
    if (!done.length) notes.push('no field declared yet')
    notes.push('grade and fed are not kept in the app')
    wentRows.push([
      r.area.area.crop,
      unitWord(unit),
      prod(declared, unit),
      prod(sold, unit),
      prod(binBu != null ? bushelsInUnit(binBu, unit, lb) : null, unit),
      prod(shrinkBu != null ? bushelsInUnit(shrinkBu, unit, lb) : null, unit),
      null,
      null,
      r1(avgDock),
      lb,
      notes.join('; '),
    ])
  }

  const harvested = rows.filter((r) => r.harvest.status === 'harvested')
  const allDone = rows.length > 0 && harvested.length === rows.length && harvested.every((r) => r.harvest.completed)
  const lastDay = allDone ? harvested.map((r) => r.harvest.completed!).sort().at(-1)! : null
  const lines: Cell[][] = [
    ['Crop year', inp.year, 'Filled from the app', ''],
    ['AFSC client number', null, 'Blank — fill in', 'From your Statement of Coverage and Premium. Not kept in the app.'],
    ['Contract or policy number', null, 'Blank — fill in', 'From your Statement of Coverage and Premium. Not kept in the app.'],
    ['Date harvest was completed', lastDay, lastDay ? 'Filled from the app' : 'Blank — fill in', lastDay ? 'The last load marked off the last field.' : 'Harvest is not finished on every field, or a field has no last load marked.'],
    ['Changes to carryover since the Report of Grain in Storage Prior to Harvest', null, 'Blank — fill in', 'Grain on hand before harvest that has changed since the August report.'],
    ['Uninsured production', null, 'Blank — fill in', 'Production from crops or acres not insured, if any.'],
    ['Volunteer production', null, 'Blank — fill in', 'Other grain or seed mixed in, if any.'],
    ['Unharvested or abandoned acres', null, 'Blank — fill in', 'Each needs a reason, the land location, the acres and a yield estimate. Report by 15 November, last day 31 December.'],
    ['Grade, bushel weight and dockage of stored and fed grain', null, 'Blank — fill in', 'Dockage is averaged from the buyers’ tickets where there are any; grade is not kept in the app.'],
  ]

  const sections: ReportSection[] = [
    { title: 'For the form', head: LINE_HEAD, rows: lines },
    { title: 'By crop', note: 'Irrigated and dryland are insured apart, so each crop has a line for each. Production counts declared fields only.', head: CROP_HEAD, rows: summaryRows, empty: 'No crop is seeded this year.' },
    { title: 'Where it went', note: 'Sold or delivered is the buyers’ tickets where they are in, else our own weights. In bins now is this crop year’s grain in the bins today.', head: WENT_HEAD, rows: wentRows, empty: 'Nothing harvested yet.' },
    ...fieldSections,
    { title: 'Not on this report', note: 'Not ours to insure, on its own report, or not seeded.', head: ['Field or crop', 'Why'], rows: left.map((l) => { const m = /^(.*) \((.*)\)$/.exec(l); return m ? [m[1], m[2]] : [l, null] }), empty: 'Nothing left off.' },
  ]

  const ac = (n: number) => `${fmt(n)} ac`
  return {
    title: 'Harvested production report',
    subtitle: `Crop year ${inp.year} · ${partyLabel(inp.party ?? '')} · worksheet for AFSC`,
    meta: [
      ['Crops', new Set(rows.map((r) => r.area.area.cropId)).size],
      ['Fields', new Set(rows.map((r) => r.area.field.id)).size],
      ['Harvested', harvested.length],
      ['Not declared yet', rows.length - harvested.length],
      ['Seeded acres', ac(rows.reduce((s, r) => s + (r.area.area.acres ?? 0), 0))],
      ['Due', `15 Nov ${inp.year}`],
    ],
    lead: [
      `AFSC's Harvested Production Report is filed online in AFSC Connect (or by email, mail or fax) once harvest is done: annual crops by 15 November ${inp.year}, hay and other perennials by 15 October. Late reports are taken until 31 December with a fee; after that the yield is recorded as zero.`,
      'This worksheet is laid out the same way to copy from: each crop with irrigated and dryland apart, then field by field with the legal land, acres, the date harvest finished, production and where it went.',
      'Production is only what was weighed or written down for the field. A field with no recorded harvest says so and is never filled with an expected yield. Blank means the app does not hold it: fill it in.',
      'Each 50/50 joint venture is insured under its own agreement, so it has its own report with its fields whole: pick it under “Report for”. Crops insured through their contract (Corteva’s seed canola) are not on any AFSC report.',
    ],
    orientation: 'landscape',
    sections,
    filename: `AFSC harvested production ${inp.year}${inp.party ? ` ${inp.party} JV` : ''}`,
    rows: rows.length,
  }
}

/* ── The gather ─────────────────────────────────────────────────────────── */

/**
 * A crop year's harvest as the app records it: the crops, each field's
 * declared harvest, every load weighed, the grain ledger, the buyers'
 * tickets, and the names of the bins and buyers. Read once for the HPR and
 * the cash advance worksheet (cash-advance.ts), so the two count the same
 * bushels. The columns are what both need: the tickets and loads carry what
 * the deliveries list (checkoff-refunds.ts grainSales) reads too.
 */
export type HarvestCrop = ProdCrop & { category: string | null; afsc_insured: boolean | null }
export type HarvestLoad = LoadLite & { crop_year: number; contract_id: string | null }
export type HarvestMove = ProdMove & { contract_id: string | null }
export type HarvestTicket = ProdTicket & { id: string; crop_year: number; contract_id: string | null; buyer: string | null; delivered_on: string }
export type HarvestRecords = {
  crops: HarvestCrop[]
  history: HistoryRow[]
  loads: HarvestLoad[]
  moves: HarvestMove[]
  tickets: HarvestTicket[]
  bins: { id: string; name: string; site: string | null }[]
  sites: { id: string; name: string }[]
}

export async function loadHarvestRecords(year: number): Promise<HarvestRecords> {
  const [crops, history, loads, moves, tickets, bins, sites] = await Promise.all([
    fetchAll<HarvestCrop>((a, b) => supabase.from('crops').select('id, name, yield_unit, test_weight_lb_per_bu, own_use, category, afsc_insured').order('id').range(a, b)),
    fetchAll<HistoryRow>((a, b) => supabase.from('crop_history').select('field_id, crop_id, acres, yield_per_acre, yield_unit, actual_yield_total, source, scale_acres, scale_at').eq('crop_year', year).order('id').range(a, b)),
    fetchAll<HarvestLoad>((a, b) =>
      supabase
        .from('bin_loads')
        .select('id, crop_year, field_id, crop_id, bin_id, delivery_site_id, contract_id, loaded_on, gross_kg, tare_kg, net_kg, bushels, lb_per_bu, last_from_field')
        .eq('crop_year', year)
        .order('id')
        .range(a, b),
    ),
    fetchAll<HarvestMove>((a, b) => supabase.from('grain_movements').select('bin_id, crop_id, crop_year, contract_id, movement_type, bushels, moved_at, ticket_number').eq('crop_year', year).order('id').range(a, b)),
    fetchAll<HarvestTicket>((a, b) =>
      supabase.from('scale_tickets').select('id, crop_year, crop_id, contract_id, buyer, ticket_no, delivered_on, net_lb, net_units, unit, dockage_pct, bin_load_id').eq('crop_year', year).order('id').range(a, b),
    ),
    fetchAll<{ id: string; name: string; site: string | null }>((a, b) => supabase.from('bins').select('id, name, site').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('delivery_sites').select('id, name').order('id').range(a, b)),
  ])
  return { crops, history, loads, moves, tickets, bins, sites }
}

export async function gatherAfscProduction(p: ParamValues, ctx: GatherContext): Promise<SectionedReport> {
  const year = yearParam(p, ctx)
  const party = p.insured ?? ''
  const [basics, ins, { crops, history, loads, moves, tickets, bins, sites }, hailMarks, inspections] = await Promise.all([
    loadSeasonBasics(year),
    loadInsuranceContext(year, party),
    loadHarvestRecords(year),
    fetchAll<HailMark>((a, b) => supabase.from('field_hail_events').select('field_id, event_date, notes').eq('crop_year', year).order('id').range(a, b)),
    fetchAll<Inspection>((a, b) =>
      supabase
        .from('hail_inspections')
        .select('inspection_number, field_id, land_location, crop_label, damage_date, report_date, loss_notice_date, adjuster, acres, loss_pct, bands, status')
        .gte('damage_date', `${year}-01-01`)
        .lte('damage_date', `${year}-12-31`)
        .order('id')
        .range(a, b),
    ),
  ])
  const { kept, left } = insurableAreas(basics, ins)
  if (!kept.length) throw new Error(party ? `Nothing is seeded on the joint venture with ${party} for ${year}.` : `No crop is seeded on an active field for ${year}.`)
  const binNames = new Map(bins.map((x) => [x.id, x.name]))
  const siteNames = new Map(sites.map((x) => [x.id, x.name]))
  const { rows, ...report } = productionReport({
    year,
    party,
    today: ctx.today,
    areas: kept,
    left,
    crops,
    history,
    loads,
    moves,
    tickets,
    deals: ins.deals,
    began: basics.harvested,
    hailMarks,
    inspections,
    binName: (id) => binNames.get(id) ?? null,
    siteName: (id) => siteNames.get(id) ?? null,
  })
  if (!rows) throw new Error(`Every crop on the ${year} plan is someone else’s to insure.`)
  return report
}
