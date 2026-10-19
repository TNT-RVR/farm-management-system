import { compareFieldNames } from '@/lib/queries'
import { cropAlerts, type CropAlert } from '@/lib/crop-weather'
import { HARVEST_SOURCE_LABEL } from '@/lib/harvest-date'
import { daysBetween } from '@/lib/harvest-estimate'
import type { HarvestEstimateRow } from '@/lib/harvest-estimate-data'
import type { YieldRecord } from '@/lib/forecast'
import type { YieldCut } from '@/lib/yield-estimate'
import type { Versus, YieldScore } from '@/lib/yield-goal'
import type { ReportSection } from '@/lib/table-report'
import { byCrop, dealNetOf, type BookRow, type CropBooks } from './crop-books'
import { fieldLabel, pdfValue, type Cell, type ReportColumn, type ReportData, type SectionedReport } from './framework'

/**
 * The season wrap-up: each field's year on one page, for the bank, the
 * insurer and next year's plan — what was grown and on how many acres, when
 * it went in and came off against when it was expected to, its yield against
 * the goal and the estimate, the cuts and the hail, the water, and what it
 * earned and cost. Then the farm by crop, and the best and worst fields.
 *
 * Nothing in here is new arithmetic. Every figure is one another screen
 * already shows:
 *
 *   - the ROWS, acres, goal, estimate and actual are the Financials plan's
 *     (usePlanRows, scored by yield-goal.ts — what the Plan tab and the
 *     "Yield against estimate and goal" report say);
 *   - the MONEY is the crop books' (crop-books.ts — the Crop P&L report's
 *     figures, row for row: the plan's revenue, the P&L Map's costs, the land
 *     deal's split), and the farm's margin is worked out as that report's is;
 *   - the DATES are the harvest estimate's (harvest-estimate-data.ts: seeding,
 *     the estimated maturity, and effectiveHarvestDate for when it came off);
 *   - hail is field_hail_events (AFSC's inspections applied, and marks made by
 *     hand), cuts are yield_adjustments as the plan applies them, water is
 *     the gross the pivots logged (as the Field season summary and Water use
 *     reports total it), rain and stress days the water balance's season.
 *
 * What the viewer cannot see stays unseen. The fixed-cost breakdown is the
 * owners' and the accountant's alone (the database gives nobody else a row),
 * so for anyone else it says "hidden" rather than a number; the fixed $/ac
 * every budget charges is everyone's.
 */

/* ── Inputs ─────────────────────────────────────────────────────────────── */

/** The plan's row as the wrap-up reads it (planner.ts PlanRowView, scored). */
export type WrapPlanRow = {
  field: { id: string; name: string; legal_land_description?: string | null }
  plan: { crop_id: string; variety: string | null } | null
  crop: { id: string; name: string; yield_unit: string | null; land_rent_only?: boolean | null; renter_only?: boolean | null } | null
  acres: number | null
  cut: YieldCut | null
  cutPct: number
  zoneId?: string | null
  isZone?: boolean
  score?: YieldScore | null
}

export type WrapHail = { field_id: string; event_date: string; loss_pct: number | null; acres: number | null; notes: string | null }
export type WrapWork = { field_id: string; zone_id: string | null; crop_id: string | null; label: string; counts_as: string | null; started_at: string | null }
export type WrapScouting = { field_id: string | null; category: string; severity: number; resolved_at: string | null }
export type WrapInspection = { field_id: string; crop_id: string | null; status: string; rating: string | null; inspected_on: string | null }
export type WrapWeatherDay = { date: string; tmax: number | null; tmin: number | null }
export type FixedPart = { label: string; perAcre: number | null }

export type WrapUpInput = {
  year: number
  /** The farm's calendar day, YYYY-MM-DD: the weather is read up to it. */
  today: string
  /** One field only (the field page's link); null for the whole farm. */
  fieldId: string | null
  planRows: WrapPlanRow[]
  books: CropBooks
  estimates: Pick<HarvestEstimateRow, 'fieldId' | 'zoneId' | 'cropId' | 'variety' | 'seeded' | 'harvestedOn' | 'harvestedFrom' | 'estimate' | 'reasons'>[]
  history: YieldRecord[]
  hail: WrapHail[]
  /** Gross irrigation logged per field, mm, and the days watered. */
  irrigation: Map<string, { mm: number; days: number }>
  /** The water balance's season per field: rain, mm, and days under stress. */
  seasonWater: Map<string, { rainMm: number | null; stressDays: number | null }>
  /** Measured days at each field's weather station. */
  weather: Map<string, WrapWeatherDay[]>
  work: WrapWork[]
  scouting: WrapScouting[]
  inspections: WrapInspection[]
  /** Owners and the accountant (canSeeFinances): the fixed-cost breakdown is theirs to see. */
  finance: boolean
  /** The breakdown's parts, $/ac; null when there is none to show (or the viewer may not see it). */
  fixedParts: FixedPart[] | null
}

/* ── The assembled wrap-up ──────────────────────────────────────────────── */

export type WrapMoney = {
  revenue: number | null
  price: number | null
  priceFrom: string
  /** Where the yield the revenue is worked on came from: 'actual' is the scale. */
  yieldFrom: BookRow['yieldFrom']
  dealNet: number
  deal: string | null
  inputs: number
  fixed: number
  fuelTrucking: number
  cost: number
  margin: number | null
  unpriced: number
}

export type WrapArea = {
  key: string
  fieldId: string
  field: string
  zoneId: string | null
  cropId: string
  crop: string
  unit: string | null
  variety: string | null
  acres: number | null
  seeded: string | null
  harvestEstimate: string | null
  harvestEstimateWhy: string | null
  harvested: string | null
  harvestedFrom: string | null
  /** Harvested − estimated, days: positive is later than expected. */
  harvestVsEstimate: number | null
  goal: number | null
  goalFrom: 'field' | 'crop default' | null
  estimate: number | null
  estimateFrom: string | null
  actual: number | null
  actualBasis: 'clean' | 'pre-clean' | null
  actualClean: number | null
  actualPreClean: number | null
  vsEstimate: Versus | null
  vsGoal: Versus | null
  cut: { pct: number; reason: string } | null
  money: WrapMoney | null
  notes: string[]
}

export type WrapField = {
  fieldId: string
  field: string
  legal: string | null
  areas: WrapArea[]
  hail: WrapHail[]
  irrigationMm: number | null
  irrigationDays: number
  rainMm: number | null
  stressDays: number | null
  notes: string[]
}

export type WrapCrop = {
  cropId: string
  crop: string
  unit: string | null
  fields: number
  acres: number
  harvestedAcres: number
  areas: number
  harvested: number
  /** Acre-weighted over the harvested areas; goal and estimate over the same areas, so the % compares like with like. */
  actual: number | null
  goal: number | null
  estimate: number | null
  vsGoal: Versus | null
  vsEstimate: Versus | null
  revenue: number
  cost: number
  margin: number
  /** Areas with no yield or no price yet: their costs count, their margin does not. */
  unknownMargin: number
}

export type WrapTotals = {
  acres: number
  revenue: number
  dealNet: number
  cost: number
  margin: number
  /** Costs on fields with nothing of ours planned: in the costs, in no crop's margin (as on the Crop P&L). */
  costsOffPlan: number
  /** Rent received on land rented out for a flat rent, less its land share of the fixed costs. */
  rentIn: { landlord: string; amount: number; landShare: number }[]
}

export type Standout = { measure: string; best: string | null; worst: string | null }

export type WrapUp = {
  year: number
  fieldId: string | null
  fields: WrapField[]
  crops: WrapCrop[]
  totals: WrapTotals
  standouts: Standout[]
  fixedPerAcre: number | null
  fixedFrom: number | null
  finance: boolean
  fixedParts: FixedPart[] | null
  offBooks: CropBooks['offBooks']
}

/* ── Small helpers ──────────────────────────────────────────────────────── */

const r1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10)
const r0 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v))
const pos = (v: unknown) => {
  const n = typeof v === 'number' ? v : v == null ? NaN : Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** How an actual stands against a reference (yield-goal.ts versus), for the crop totals. */
function versusOf(actual: number | null, ref: number | null): Versus | null {
  if (actual == null || ref == null || !(ref > 0)) return null
  const diff = actual - ref
  const pct = (diff / ref) * 100
  return { diff, pct, dir: Math.abs(pct) < 0.5 ? 'on' : diff > 0 ? 'above' : 'below' }
}

/** "+7.2 (+13%)", "−3 (−5%)", "on". */
export function versusCell(v: Versus | null): string | null {
  if (!v) return null
  if (v.dir === 'on') return 'on'
  const sign = v.diff > 0 ? '+' : '−'
  const amount = Math.abs(v.diff).toLocaleString('en-CA', { maximumFractionDigits: 1 })
  return `${sign}${amount} (${sign}${Math.abs(Math.round(v.pct))}%)`
}

const money0 = (v: number | null | undefined) => (v == null ? null : (pdfValue(v, { label: '', decimals: 0, money: true }) as string))
const money2 = (v: number | null | undefined) => (v == null ? null : (pdfValue(v, { label: '', decimals: 2, money: true }) as string))
const yieldWords = (v: number | null, unit: string | null) => (v == null ? null : `${v.toLocaleString('en-CA', { maximumFractionDigits: v >= 100 ? 0 : 1 })} ${unit ?? 'bu'}/ac`)
const inchesOf = (mm: number | null) => (mm == null ? null : Math.round((mm / 25.4) * 10) / 10)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const per = (v: number | null, acres: number | null) => (v == null || !acres ? null : v / acres)

/**
 * The harvested yield, clean and before clean-out, acre-weighted over the
 * year's rows for this crop — the rows yield-goal.ts actualYield reads.
 */
export function cleanAndPreClean(history: readonly YieldRecord[], at: { fieldId: string; cropId: string; year: number; unit: string | null }): { clean: number | null; preClean: number | null } {
  const rows = history.filter(
    (r) =>
      r.field_id === at.fieldId &&
      r.crop_id === at.cropId &&
      r.crop_year === at.year &&
      r.source !== 'fah_import' &&
      r.source !== 'rotation_xlsx' &&
      (r.yield_unit ?? at.unit) === at.unit,
  )
  const weighted = (pick: (r: YieldRecord) => number | null) => {
    const use = rows.filter((r) => pick(r) != null)
    if (!use.length) return null
    let w = 0
    let s = 0
    for (const r of use) {
      const a = pos(r.acres) ?? 1
      w += a
      s += a * pick(r)!
    }
    return s / w
  }
  return { clean: weighted((r) => pos(r.clean_yield_per_acre)), preClean: weighted((r) => pos(r.yield_per_acre)) }
}

/** Heat and frost in the crop's tender stages (crop-weather.ts), summed up for one crop area. */
export function weatherNotes(crop: string, seeded: string | null, until: string, days: readonly WrapWeatherDay[]): string[] {
  if (!seeded) return []
  const alerts = cropAlerts({ crop, plantedOn: seeded, harvestStarted: false, forecast: days.filter((d) => d.date >= seeded && d.date <= until) })
  const out: string[] = []
  const say = (list: CropAlert[], kind: 'heat' | 'frost') => {
    if (!list.length) return
    const dates = list.map((a) => a.date).sort()
    const extreme = kind === 'heat' ? Math.max(...list.map((a) => a.temp)) : Math.min(...list.map((a) => a.temp))
    const span = dates.length === 1 ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`
    const what = kind === 'heat' ? `${plural(list.length, 'day')} of heat, up to ${extreme.toFixed(1)} °C` : `${plural(list.length, 'night')} of frost, down to ${extreme.toFixed(1)} °C`
    out.push(`${what} (${span}): ${list[0].why}`)
  }
  say(
    alerts.filter((a) => a.kind === 'heat'),
    'heat',
  )
  say(
    alerts.filter((a) => a.kind === 'frost'),
    'frost',
  )
  return out
}

const HARVEST_FROM: Record<string, string> = { ...HARVEST_SOURCE_LABEL, scale: 'the scale yield’s date' }

/* ── Assembly ───────────────────────────────────────────────────────────── */

/** The book row behind a plan row: same field, same crop area, same crop. */
function bookFor(books: BookRow[], r: WrapPlanRow): BookRow | null {
  const cropId = r.crop?.id
  const here = books.filter((b) => b.fieldId === r.field.id && b.crop?.id === cropId)
  return here.find((b) => (b.zoneId ?? null) === (r.zoneId ?? null)) ?? (here.length === 1 ? here[0] : null)
}

function moneyOf(b: BookRow): WrapMoney {
  return {
    revenue: b.gross == null && !b.otherRevenue ? null : (b.gross ?? 0) + b.otherRevenue,
    price: b.price,
    priceFrom: b.priceFrom,
    yieldFrom: b.yieldFrom,
    dealNet: dealNetOf(b),
    deal: b.deal,
    inputs: b.inputs,
    fixed: b.costs.fixed,
    fuelTrucking: b.costs.fuel + b.costs.trucking,
    cost: b.cost,
    margin: b.margin,
    unpriced: b.unpriced,
  }
}

export function buildWrapUp(inp: WrapUpInput): WrapUp {
  const { year } = inp
  const offBooks = new Set(inp.books.offBooks.map((o) => `${o.field}:${o.crop}`))
  const rows = inp.planRows.filter(
    (r) => r.crop && (r.plan || r.isZone) && (!inp.fieldId || r.field.id === inp.fieldId) && !offBooks.has(`${r.field.name}:${r.crop.name}`),
  )

  const estimateFor = (r: WrapPlanRow) =>
    inp.estimates.find((e) => e.fieldId === r.field.id && e.cropId === r.crop!.id && (e.zoneId ?? null) === (r.zoneId ?? null)) ??
    inp.estimates.find((e) => e.fieldId === r.field.id && e.cropId === r.crop!.id) ??
    null

  const byField = new Map<string, WrapField>()
  for (const r of rows) {
    const crop = r.crop!
    const est = estimateFor(r)
    const book = bookFor(inp.books.rows, r)
    const score = r.score ?? null
    const unit = crop.yield_unit
    const seeded = est?.seeded ?? est?.estimate?.seeded ?? null
    const harvestEstimate = est?.estimate && !est.estimate.notReached ? est.estimate.mature : null
    const harvested = est?.harvestedOn ?? null
    const cc = cleanAndPreClean(inp.history, { fieldId: r.field.id, cropId: crop.id, year, unit })
    const notes: string[] = []
    if (score?.actual?.abnormal != null) notes.push(`Abnormal — left out of averages${score.actual.abnormal ? `: ${score.actual.abnormal}` : ''}.`)
    if (score?.estimate.fromDefault) notes.push('The estimate is the crop’s default yield: not enough harvests yet.')
    if (est?.estimate?.notReached) notes.push('The estimate did not reach maturity by the end of the year.')
    if (book && book.yieldFrom !== 'actual' && book.yieldFrom !== 'none' && unit !== 'ac') notes.push('Revenue is on the expected yield: the scale does not have this crop yet.')
    if (book?.unpriced) notes.push(`${plural(book.unpriced, 'cost line')} on the field with no price in the price book.`)
    if (!book) notes.push('Not in the crop books: no revenue or costs for it.')
    for (const i of inp.inspections.filter((x) => x.field_id === r.field.id && x.crop_id === crop.id))
      notes.push(`Inspection${i.inspected_on ? ` ${i.inspected_on}` : ''}: ${i.status.replace(/_/g, ' ')}${i.rating ? `, ${i.rating}` : ''}.`)
    notes.push(...weatherNotes(crop.name, seeded, harvested ?? inp.today, inp.weather.get(r.field.id) ?? []))

    const area: WrapArea = {
      key: `${r.field.id}:${r.zoneId ?? ''}:${crop.id}`,
      fieldId: r.field.id,
      field: r.field.name,
      zoneId: r.zoneId ?? null,
      cropId: crop.id,
      crop: crop.name,
      unit,
      variety: est?.variety ?? (r.plan?.crop_id === crop.id ? r.plan.variety : null) ?? null,
      acres: r.acres,
      seeded,
      harvestEstimate,
      harvestEstimateWhy: est?.reasons ?? null,
      harvested,
      harvestedFrom: est?.harvestedFrom ? (HARVEST_FROM[est.harvestedFrom] ?? est.harvestedFrom) : null,
      harvestVsEstimate: harvested && harvestEstimate ? daysBetween(harvestEstimate, harvested) : null,
      goal: score?.goal.value ?? null,
      goalFrom: score?.goal.source === 'field' ? 'field' : score?.goal.source === 'crop' ? 'crop default' : null,
      estimate: score?.estimate.value ?? null,
      estimateFrom: score?.estimate.note ?? null,
      actual: score?.actual?.value ?? null,
      actualBasis: score?.actual ? (score.actual.clean ? 'clean' : 'pre-clean') : null,
      actualClean: cc.clean,
      actualPreClean: cc.preClean,
      vsEstimate: score?.vsEstimate ?? null,
      vsGoal: score?.vsGoal ?? null,
      cut: r.cut && r.cut.loss_pct > 0 ? { pct: r.cut.loss_pct, reason: r.cut.reason } : null,
      money: book ? moneyOf(book) : null,
      notes,
    }

    let f = byField.get(r.field.id)
    if (!f) {
      const irr = inp.irrigation.get(r.field.id)
      const sw = inp.seasonWater.get(r.field.id)
      const fieldNotes: string[] = []
      const work = inp.work.filter((w) => w.field_id === r.field.id)
      if (work.length) {
        const counts = new Map<string, number>()
        for (const w of work) counts.set(w.label, (counts.get(w.label) ?? 0) + 1)
        fieldNotes.push(`Work entered by hand: ${[...counts].map(([k, n]) => (n > 1 ? `${k} (${n})` : k)).join(', ')}.`)
      }
      const scouted = inp.scouting.filter((s) => s.field_id === r.field.id)
      if (scouted.length) {
        const cats = new Map<string, number>()
        for (const s of scouted) cats.set(s.category, (cats.get(s.category) ?? 0) + 1)
        const open = scouted.filter((s) => !s.resolved_at).length
        const worst = Math.max(...scouted.map((s) => s.severity))
        fieldNotes.push(`Scouting: ${[...cats].map(([k, n]) => `${n} ${k}`).join(', ')} (worst severity ${worst}${open ? `, ${open} not resolved` : ''}).`)
      }
      for (const i of inp.inspections.filter((x) => x.field_id === r.field.id && !x.crop_id))
        fieldNotes.push(`Inspection${i.inspected_on ? ` ${i.inspected_on}` : ''}: ${i.status.replace(/_/g, ' ')}${i.rating ? `, ${i.rating}` : ''}.`)
      if (sw?.stressDays) fieldNotes.push(`${plural(sw.stressDays, 'day')} short of water in the water balance.`)
      f = {
        fieldId: r.field.id,
        field: r.field.name,
        legal: r.field.legal_land_description ?? null,
        areas: [],
        hail: inp.hail.filter((h) => h.field_id === r.field.id).sort((a, b) => a.event_date.localeCompare(b.event_date)),
        irrigationMm: irr ? irr.mm : null,
        irrigationDays: irr?.days ?? 0,
        rainMm: sw?.rainMm ?? null,
        stressDays: sw?.stressDays ?? null,
        notes: fieldNotes,
      }
      byField.set(r.field.id, f)
    }
    f.areas.push(area)
  }

  const fields = [...byField.values()].sort((a, b) => compareFieldNames(a.field, b.field))
  const areas = fields.flatMap((f) => f.areas)

  // By crop: yields from the areas, money from the books (Crop P&L's own roll-up).
  const bookRows = inp.fieldId ? inp.books.rows.filter((b) => b.fieldId === inp.fieldId) : inp.books.rows
  const money = new Map(byCrop(bookRows).map((t) => [t.crop.id, t]))
  // Every crop with an area or a line in the books, so the crops add up to the farm.
  const cropIds = [...new Set([...areas.map((a) => a.cropId), ...money.keys()])]
  const crops: WrapCrop[] = cropIds
    .map((id) => {
      const list = areas.filter((a) => a.cropId === id)
      const t = money.get(id)
      const done = list.filter((a) => a.actual != null && (a.acres ?? 0) > 0)
      const doneAcres = done.reduce((s, a) => s + (a.acres ?? 0), 0)
      const avg = (pickV: (a: WrapArea) => number | null) => {
        const use = done.filter((a) => pickV(a) != null)
        const w = use.reduce((s, a) => s + (a.acres ?? 0), 0)
        // Only when every harvested area has the figure: a partial average would compare unlike acres.
        return use.length === done.length && w > 0 ? use.reduce((s, a) => s + pickV(a)! * (a.acres ?? 0), 0) / w : null
      }
      const actual = avg((a) => a.actual)
      const goal = avg((a) => a.goal)
      const estimate = avg((a) => a.estimate)
      return {
        cropId: id,
        crop: list[0]?.crop ?? t?.crop.name ?? 'Crop',
        unit: list[0]?.unit ?? t?.crop.yield_unit ?? null,
        fields: new Set(list.map((a) => a.fieldId)).size || (t?.fields ?? 0),
        acres: list.length ? list.reduce((s, a) => s + (a.acres ?? 0), 0) : (t?.acres ?? 0),
        harvestedAcres: doneAcres,
        areas: list.length,
        harvested: done.length,
        actual,
        goal,
        estimate,
        vsGoal: versusOf(actual, goal),
        vsEstimate: versusOf(actual, estimate),
        revenue: t?.gross ?? 0,
        cost: t?.cost ?? 0,
        margin: t?.margin ?? 0,
        unknownMargin: t?.unknown ?? 0,
      }
    })
    .sort((a, b) => a.crop.localeCompare(b.crop))

  // The farm's totals, as the Crop P&L works its margin out.
  const cropTotals = [...money.values()]
  const none = bookRows.filter((b) => !b.crop)
  const rentIn = inp.fieldId ? [] : inp.books.rentIn
  const totals: WrapTotals = {
    acres: cropTotals.reduce((s, t) => s + t.acres, 0),
    revenue: cropTotals.reduce((s, t) => s + t.gross, 0),
    dealNet: cropTotals.reduce((s, t) => s + t.dealNet, 0) + rentIn.reduce((s, r) => s + r.amount, 0),
    cost: cropTotals.reduce((s, t) => s + t.cost, 0) + none.reduce((s, r) => s + r.cost, 0) + rentIn.reduce((s, r) => s + r.landShare, 0),
    margin: cropTotals.reduce((s, t) => s + t.margin, 0) + rentIn.reduce((s, r) => s + r.amount - r.landShare, 0),
    costsOffPlan: none.reduce((s, r) => s + r.cost, 0),
    rentIn,
  }

  return {
    year,
    fieldId: inp.fieldId,
    fields,
    crops,
    totals,
    standouts: standouts(areas),
    fixedPerAcre: inp.books.fixedPerAcre,
    fixedFrom: inp.books.fixedFrom,
    finance: inp.finance,
    fixedParts: inp.finance ? inp.fixedParts : null,
    offBooks: inp.fieldId ? [] : inp.books.offBooks,
  }
}

const areaName = (a: WrapArea) => `${fieldLabel(a.field)} ${a.crop}`

/** The best and the worst crop area on each measure, where two or more can be compared. */
export function standouts(areas: WrapArea[]): Standout[] {
  const rank = (measure: string, value: (a: WrapArea) => number | null, say: (a: WrapArea, v: number) => string): Standout | null => {
    const scored = areas.map((a) => ({ a, v: value(a) })).filter((x): x is { a: WrapArea; v: number } => x.v != null && Number.isFinite(x.v))
    if (scored.length < 2) return null
    scored.sort((x, y) => y.v - x.v || compareFieldNames(x.a.field, y.a.field))
    const best = scored[0]
    const worst = scored[scored.length - 1]
    return { measure, best: say(best.a, best.v), worst: say(worst.a, worst.v) }
  }
  return [
    rank(
      'Margin an acre',
      (a) => (a.money?.margin != null && a.acres ? a.money.margin / a.acres : null),
      (a, v) => `${areaName(a)}: ${money2(v)}/ac`,
    ),
    rank(
      'Yield against goal',
      (a) => a.vsGoal?.pct ?? null,
      (a) => `${areaName(a)}: ${yieldWords(a.actual, a.unit)}, ${versusCell(a.vsGoal)} against goal`,
    ),
    rank(
      'Yield against estimate',
      (a) => a.vsEstimate?.pct ?? null,
      (a) => `${areaName(a)}: ${yieldWords(a.actual, a.unit)}, ${versusCell(a.vsEstimate)} against estimate`,
    ),
  ].filter((s): s is Standout => s != null)
}

/* ── The PDF: the farm, then a page a field ─────────────────────────────── */

const HIDDEN = 'hidden (owners and the accountant only)'

function fieldNote(f: WrapField): string {
  return [
    f.legal,
    f.irrigationMm != null ? `${inchesOf(f.irrigationMm)} in irrigation over ${plural(f.irrigationDays, 'day')}` : 'no irrigation logged',
    f.rainMm != null ? `${inchesOf(f.rainMm)} in rain` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function hailWords(h: WrapHail): string {
  const loss = h.loss_pct != null ? `${r0(h.loss_pct)}% loss` : 'marked, no loss assessed'
  const acres = h.acres != null ? ` on ${r1(h.acres)} ac` : ''
  return `${h.event_date}: ${loss}${acres}${h.notes ? ` (${h.notes})` : ''}`
}

/** One field's page: a column for each crop on it (a split field has several). */
export function fieldSection(f: WrapField, finance: boolean, first: boolean): ReportSection {
  const cols = f.areas
  const head = ['', ...cols.map((a) => (cols.length > 1 ? `${a.crop}${a.zoneId ? ' (area)' : ''}` : a.crop))]
  const line = (label: string, cell: (a: WrapArea) => Cell): Cell[] => [label, ...cols.map(cell)]
  /** A fact about the whole field: in the first column. */
  const whole = (label: string, v: Cell): Cell[] => [label, v, ...cols.slice(1).map(() => (v == null ? null : '(whole field)'))]
  const rows: Cell[][] = [
    line('Variety', (a) => a.variety),
    line('Acres (mapped)', (a) => (a.acres == null ? null : (pdfValue(a.acres, { label: '', upTo: 1 }) as string))),
    line('Seeded', (a) => a.seeded),
    line('Harvest estimated', (a) => a.harvestEstimate),
    // Fallow and the like (yield in acres) is never harvested: nothing to say.
    line('Harvested', (a) => (a.harvested ? `${a.harvested}${a.harvestedFrom ? ` (${a.harvestedFrom})` : ''}` : a.unit === 'ac' ? null : 'not yet')),
    line('Harvest against estimate', (a) => (a.harvestVsEstimate == null ? null : a.harvestVsEstimate === 0 ? 'on the day' : `${Math.abs(a.harvestVsEstimate)} days ${a.harvestVsEstimate > 0 ? 'later' : 'earlier'}`)),
    line('Yield goal', (a) => (a.goal == null ? null : `${yieldWords(a.goal, a.unit)}${a.goalFrom ? ` (${a.goalFrom})` : ''}`)),
    line('Yield estimate', (a) => yieldWords(a.estimate, a.unit)),
    line('Estimate from', (a) => a.estimateFrom),
    line('Actual yield', (a) => (a.actual == null ? (a.unit === 'ac' ? null : 'not harvested') : `${yieldWords(a.actual, a.unit)} (${a.actualBasis})`)),
    line('Clean / pre-clean', (a) => (a.actualClean == null && a.actualPreClean == null ? null : `${yieldWords(a.actualClean, a.unit) ?? '—'} / ${yieldWords(a.actualPreClean, a.unit) ?? '—'}`)),
    line('Against estimate', (a) => versusCell(a.vsEstimate)),
    line('Against goal', (a) => versusCell(a.vsGoal)),
    line('Yield cut applied', (a) => (a.cut ? `${a.cut.pct}% (${a.cut.reason})` : 'none')),
    whole('Hail records (AFSC and marked)', f.hail.length ? f.hail.map(hailWords).join('; ') : 'none'),
    whole('Irrigation applied', f.irrigationMm != null ? `${inchesOf(f.irrigationMm)} in gross, ${plural(f.irrigationDays, 'day')}` : 'none logged'),
    whole('Rain', f.rainMm != null ? `${inchesOf(f.rainMm)} in` : null),
    line('Price', (a) => (a.money?.price != null ? `${pdfValue(a.money.price, { label: '', upTo: 4, money: true })}/${a.unit ?? 'unit'}${a.money.priceFrom ? ` (${a.money.priceFrom})` : ''}` : null)),
    line('Revenue', (a) => money0(a.money?.revenue)),
    line('Land deal', (a) => (a.money?.deal ? `${money0(a.money.dealNet)} (${a.money.deal})` : null)),
    line('Inputs', (a) => money0(a.money?.inputs)),
    line('Fixed share', (a) => money0(a.money?.fixed)),
    line('Fuel & trucking', (a) => money0(a.money?.fuelTrucking)),
    line('Total cost', (a) => money0(a.money?.cost)),
    line('Cost an acre', (a) => money2(per(a.money?.cost ?? null, a.acres))),
    line('Margin an acre', (a) => (a.money ? (a.money.margin == null ? 'no yield or price yet' : money2(per(a.money.margin, a.acres))) : null)),
    line('Margin', (a) => money0(a.money?.margin)),
    line('Notes', (a) => a.notes.join(' ') || null),
    whole('Field notes', f.notes.join(' ') || null),
  ]
  if (!finance) rows.push(whole('Fixed-cost breakdown', HIDDEN))
  return {
    title: fieldLabel(f.field),
    note: fieldNote(f),
    head,
    // Labels and words: nothing to right-align.
    align: head.map(() => 'left' as const),
    rows: rows.filter((r) => r.slice(1).some((c) => c != null)),
    pageBreakBefore: !first,
  }
}

export const CROP_HEAD = ['Crop', 'Fields', 'Acres', 'Harvested', 'Yield /ac', 'Goal /ac', 'vs goal', 'Estimate /ac', 'vs estimate', 'Revenue', 'Costs', 'Margin /ac', 'Margin']

function cropRow(c: WrapCrop): Cell[] {
  return [
    `${c.crop}${c.unit && c.unit !== 'ac' ? ` (${c.unit})` : ''}`,
    c.fields,
    pdfValue(c.acres, { label: '', decimals: 1 }),
    `${c.harvested} of ${c.areas}`,
    c.actual == null ? null : (pdfValue(c.actual, { label: '', upTo: 1 }) as string),
    c.goal == null ? null : (pdfValue(c.goal, { label: '', upTo: 1 }) as string),
    versusCell(c.vsGoal),
    c.estimate == null ? null : (pdfValue(c.estimate, { label: '', upTo: 1 }) as string),
    versusCell(c.vsEstimate),
    money0(c.revenue),
    money0(c.cost),
    money2(per(c.margin, c.acres)),
    money0(c.margin),
  ]
}

export function wrapUpPdf(w: WrapUp, title: string): SectionedReport {
  if (!w.fields.length) throw new Error(w.fieldId ? `Nothing was grown on that field in ${w.year}.` : `Nothing is planned for ${w.year} yet.`)
  const one = w.fieldId ? w.fields[0] : null
  const sections: ReportSection[] = []
  if (!one) {
    const t = w.totals
    sections.push({
      title: 'The farm by crop',
      note: 'Yield, goal and estimate are acre-weighted over the harvested acres only, so the % compares like with like. Money is the Crop P&L’s.',
      head: CROP_HEAD,
      rows: w.crops.map(cropRow),
      foot: ['Whole farm', null, pdfValue(t.acres, { label: '', decimals: 1 }), null, null, null, null, null, null, money0(t.revenue), money0(t.cost), money2(per(t.margin, t.acres)), money0(t.margin)],
    })
    if (w.standouts.length)
      sections.push({ title: 'Best and worst fields', head: ['Measure', 'Best', 'Worst'], rows: w.standouts.map((s) => [s.measure, s.best, s.worst]), align: ['left', 'left', 'left'] })
    sections.push({
      title: 'Fixed costs an acre',
      head: ['Part', '$/ac'],
      rows: w.finance
        ? (w.fixedParts ?? []).map((p) => [p.label, money2(p.perAcre)])
        : [['Breakdown', HIDDEN]],
      foot: ['Charged an acre', w.fixedPerAcre == null ? 'not set' : `${money2(w.fixedPerAcre)}${w.fixedFrom ? ` (${w.fixedFrom} figure)` : ''}`],
      empty: 'Entered as one figure, not broken into parts.',
      align: ['left', 'right'],
    })
  }
  w.fields.forEach((f, i) => sections.push(fieldSection(f, w.finance, i === 0 && Boolean(one))))

  const harvested = w.fields.flatMap((f) => f.areas).filter((a) => a.actual != null).length
  const areas = w.fields.flatMap((f) => f.areas).length
  const meta: [string, Cell][] = one
    ? [
        ['Field', fieldLabel(one.field)],
        ['Crops', one.areas.map((a) => a.crop).join(', ')],
        ['Acres', pdfValue(one.areas.reduce((s, a) => s + (a.acres ?? 0), 0), { label: '', decimals: 1 }) as string],
        ['Margin', money0(one.areas.reduce((s, a) => s + (a.money?.margin ?? 0), 0))],
      ]
    : [
        ['Fields', w.fields.length],
        ['Acres', pdfValue(w.totals.acres, { label: '', decimals: 0 }) as string],
        ['Harvested', `${harvested} of ${areas}`],
        ['Revenue', money0(w.totals.revenue)],
        ['Costs', money0(w.totals.cost)],
        ['Margin', money0(w.totals.margin)],
      ]
  meta.push(['Fixed expenses', w.fixedPerAcre != null ? `${money2(w.fixedPerAcre)}/ac${w.fixedFrom ? ` (${w.fixedFrom} figure)` : ''}` : 'not set'])
  if (!w.finance) meta.push(['Fixed-cost breakdown', HIDDEN])

  return {
    title,
    subtitle: `Crop year ${w.year} · ${one ? fieldLabel(one.field) : 'All fields'}`,
    meta,
    lead: wrapUpSummary(w),
    sections,
    filename: `Season wrap-up ${w.year} ${one ? fieldLabel(one.field) : 'All fields'}`,
  }
}

export function wrapUpSummary(w: WrapUp): string[] {
  const out = [
    'Acres are the map’s (a split field counts as its crop areas). Goal, estimate and actual are the Financials plan’s: the actual is the yield off the scale, clean where the clean-out is in. Seeding and harvest dates are the harvest estimate’s; the estimated harvest is seeding plus the variety’s days to maturity, moved by heat, sun and hail.',
    'Revenue, costs and margin are the Crop P&L’s: the plan’s yield and price, the Profit/Loss Map’s costs (inputs, the farm’s fixed $/ac, fuel and trucking), and what each land deal moves. Where the scale does not have a crop yet, revenue is on the expected yield.',
    'Hail is every record on the field (AFSC’s inspections applied, and hail marked by hand); the yield cut is the one the plan applies. Irrigation is the gross the pivots logged; rain is the field’s water balance.',
  ]
  if (!w.fieldId && w.totals.costsOffPlan) out.push(`Costs on fields with nothing of ours planned, ${money0(w.totals.costsOffPlan)}, are in the costs and in no crop’s margin, as on the Crop P&L.`)
  if (w.totals.rentIn.length) {
    const share = w.finance ? '' : ' Its land share of the fixed costs is hidden (owners and the accountant only).'
    out.push(`Rent received for land rented out: ${w.totals.rentIn.map((r) => `${r.landlord} ${money0(r.amount)}`).join(', ')}, in the land deals and the margin.${share}`)
  }
  if (w.offBooks.length) out.push(`Not on our books: ${w.offBooks.map((o) => `${o.crop} on ${fieldLabel(o.field)} (${o.why})`).join('; ')}.`)
  return out
}

/* ── The CSV: a row a crop area ─────────────────────────────────────────── */

export const WRAP_COLUMNS: ReportColumn[] = [
  { label: 'Field' },
  { label: 'Crop' },
  { label: 'Variety' },
  { label: 'Crop area' },
  { label: 'Acres', decimals: 1 },
  { label: 'Yield unit' },
  { label: 'Seeded' },
  { label: 'Harvest estimated' },
  { label: 'Harvested' },
  { label: 'Harvested from' },
  { label: 'Harvest vs estimate (days)', decimals: 0 },
  { label: 'Goal /ac', upTo: 1 },
  { label: 'Goal from' },
  { label: 'Estimate /ac', upTo: 1 },
  { label: 'Estimate from' },
  { label: 'Actual /ac', upTo: 1 },
  { label: 'Actual is' },
  { label: 'Clean /ac', upTo: 1 },
  { label: 'Pre-clean /ac', upTo: 1 },
  { label: 'vs estimate /ac', upTo: 1 },
  { label: 'vs estimate %', decimals: 0 },
  { label: 'vs goal /ac', upTo: 1 },
  { label: 'vs goal %', decimals: 0 },
  { label: 'Yield cut %', upTo: 1 },
  { label: 'Yield cut reason' },
  { label: 'Hail records' },
  { label: 'Irrigation (in)', upTo: 1 },
  { label: 'Irrigation days', decimals: 0 },
  { label: 'Rain (in)', upTo: 1 },
  { label: 'Price', upTo: 4, money: true },
  { label: 'Price from' },
  { label: 'Revenue', decimals: 0, money: true },
  { label: 'Land deal', decimals: 0, money: true },
  { label: 'Inputs', decimals: 0, money: true },
  { label: 'Fixed', decimals: 0, money: true },
  { label: 'Fuel & trucking', decimals: 0, money: true },
  { label: 'Cost', decimals: 0, money: true },
  { label: 'Margin /ac', decimals: 2, money: true },
  { label: 'Margin', decimals: 0, money: true },
  { label: 'Notes' },
]

export function wrapUpRow(f: WrapField, a: WrapArea): Cell[] {
  return [
    fieldLabel(f.field),
    a.crop,
    a.variety,
    a.zoneId ? 'area of a split field' : 'whole field',
    a.acres,
    a.unit,
    a.seeded,
    a.harvestEstimate,
    a.harvested,
    a.harvestedFrom,
    a.harvestVsEstimate,
    a.goal,
    a.goalFrom,
    a.estimate,
    a.estimateFrom,
    a.actual,
    a.actualBasis,
    a.actualClean,
    a.actualPreClean,
    a.vsEstimate?.diff ?? null,
    a.vsEstimate?.pct ?? null,
    a.vsGoal?.diff ?? null,
    a.vsGoal?.pct ?? null,
    a.cut?.pct ?? null,
    a.cut?.reason ?? null,
    f.hail.length ? f.hail.map(hailWords).join('; ') : null,
    inchesOf(f.irrigationMm),
    f.irrigationDays || null,
    inchesOf(f.rainMm),
    a.money?.price ?? null,
    a.money?.priceFrom || null,
    a.money?.revenue ?? null,
    a.money?.dealNet || null,
    a.money?.inputs ?? null,
    a.money?.fixed ?? null,
    a.money?.fuelTrucking ?? null,
    a.money?.cost ?? null,
    per(a.money?.margin ?? null, a.acres),
    a.money?.margin ?? null,
    [...a.notes, ...f.notes].join(' ') || null,
  ]
}

const blankRow = (label: string, crop: string | null, set: Partial<Record<'acres' | 'revenue' | 'deal' | 'fixed' | 'cost' | 'margin' | 'notes', Cell>>): Cell[] => {
  const r: Cell[] = WRAP_COLUMNS.map(() => null)
  const at = (l: string) => WRAP_COLUMNS.findIndex((c) => c.label === l)
  r[0] = label
  r[1] = crop
  if (set.acres !== undefined) r[at('Acres')] = set.acres
  if (set.revenue !== undefined) r[at('Revenue')] = set.revenue
  if (set.deal !== undefined) r[at('Land deal')] = set.deal
  if (set.fixed !== undefined) r[at('Fixed')] = set.fixed
  if (set.cost !== undefined) r[at('Cost')] = set.cost
  if (set.margin !== undefined) r[at('Margin')] = set.margin
  if (set.notes !== undefined) r[at('Notes')] = set.notes
  return r
}

export function wrapUpCsv(w: WrapUp, title: string): ReportData {
  if (!w.fields.length) throw new Error(w.fieldId ? `Nothing was grown on that field in ${w.year}.` : `Nothing is planned for ${w.year} yet.`)
  const rows: Cell[][] = w.fields.flatMap((f) => f.areas.map((a) => wrapUpRow(f, a)))
  if (!w.fieldId) {
    for (const r of w.totals.rentIn)
      rows.push(blankRow('Rent received', `Land rented out to ${r.landlord}`, { deal: r.amount, fixed: w.finance ? r.landShare || null : null, cost: w.finance ? r.landShare || null : null, margin: r.amount - r.landShare, notes: w.finance ? null : `Land share of the fixed costs: ${HIDDEN}.` }))
    if (w.totals.costsOffPlan) rows.push(blankRow('Fields with nothing of ours planned', null, { cost: w.totals.costsOffPlan, notes: 'In the costs, in no crop’s margin, as on the Crop P&L.' }))
  }
  const t = w.totals
  const one = w.fieldId ? w.fields[0] : null
  const totals = one
    ? blankRow('Field total', null, {
        acres: one.areas.reduce((s, a) => s + (a.acres ?? 0), 0),
        revenue: one.areas.reduce((s, a) => s + (a.money?.revenue ?? 0), 0),
        cost: one.areas.reduce((s, a) => s + (a.money?.cost ?? 0), 0),
        margin: one.areas.reduce((s, a) => s + (a.money?.margin ?? 0), 0),
      })
    : blankRow('Whole farm', null, { acres: t.acres, revenue: t.revenue, deal: t.dealNet || null, cost: t.cost, margin: t.margin, notes: w.finance ? null : `Fixed-cost breakdown: ${HIDDEN}.` })
  return {
    title,
    subtitle: `Crop year ${w.year} · ${one ? fieldLabel(one.field) : 'All fields'}`,
    columns: WRAP_COLUMNS,
    groups: [{ title: '', rows }],
    totals,
    filename: `Season wrap-up ${w.year} ${one ? fieldLabel(one.field) : 'All fields'}`,
  }
}
