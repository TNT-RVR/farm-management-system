import { supabase } from '@/lib/supabase'
import { compareFieldNames } from '@/lib/queries'
import { bushelWeightFor, convertMass } from '@/lib/bushels'
import { LB_PER_TONNE } from '@/lib/board-price'
import { isCanola } from '@/lib/canola-trait'
import { farmBrand } from '@/lib/farm-setup'
import { toPosition } from '@/lib/marketing-data'
import { dealFor, type LandDeal } from '@/lib/land-deals'
import type { ReportSection } from '@/lib/table-report'
import { fetchAll, longDate, num, yearParam, type Cell, type GatherContext, type ParamValues, type SectionedReport } from './framework'
import { insurableAreas, loadInsuranceContext, partyLabel, type InsurableArea, type InsuranceContext } from './afsc'
import { fieldHarvest, loadHarvestRecords, shareOf, toTonnes, unitWord, type HarvestCrop, type HarvestRecords, type HistoryRow, type LoadLite } from './afsc-production'
import { loadSeasonBasics, type DayFrom, type SeasonBasics } from './field-season'
import { binLines } from './grain-inventory'
import { grainSales, type Sale } from './checkoff-refunds'
import { isCalfClass } from './herd'
import { STATUS, type Status } from './agristability-form'

/**
 * The federal Advance Payments Program (APP) cash advance, as a worksheet
 * laid out in the order of CCGA's 2026-27 application to copy from. It is
 * not the administrator's form: CCGA takes its own application (a PDF, sent
 * by email or fax, or through its portal for existing customers, or by
 * phone).
 *
 * What it holds, per commodity on our own fields (each 50/50 joint venture
 * apart, under "Report for", since each may be its own applicant): acres,
 * production (the harvest where it is recorded, else the plan's expected
 * yield, marked as an estimate), what is in the bins now, contracted,
 * delivered and unpriced, and the advance at CCGA's Alberta rate on what is
 * still ours to sell; then the program's $1,000,000 maximum and the
 * interest-free part split off. The calves by weight class at CCGA's
 * per-head rates. Every advance is an ESTIMATE. Identifiers (SIN, business
 * number, AgriStability PIN, AFSC numbers), advances still owing and the
 * lenders' security are always blank to fill in, never a zero.
 *
 * Read 3 October 2026 (docs/cash-advance.md has the detail):
 *
 *   AAFC: the program, who is eligible, the administrators
 *     https://agriculture.canada.ca/en/programs/advance-payments
 *     https://agriculture.canada.ca/en/programs/advance-payments/step-2-who-eligible
 *     https://agriculture.canada.ca/en/programs/advance-payments/program-administrators
 *   Interest-free $250,000 for non-canola advances in 2026 (1 Apr 2026);
 *   canola $500,000 for 2025 and 2026 (regulations amended 16 Sep 2025)
 *     https://www.canada.ca/en/agriculture-agri-food/news/2026/04/minister-macdonald-announces-interest-free-limit-under-the-advance-payments-program-will-be-set-at-250000-for-2026-for-all-non-canola-advances.html
 *   CCGA: the program, FAQs, repayment, dates, how to apply, the 2026-27 application
 *     https://www.ccga.ca/cash-advance
 *     https://www.ccga.ca/cash-advance/faqs
 *     https://www.ccga.ca/cash-advance/how-to-repay
 *     https://www.ccga.ca/cash-advance/dates-and-deadlines
 *     https://www.ccga.ca/cash-advance/how-to-apply
 *     https://ccga.blob.core.windows.net/documents/cash-advance/CCGA_2026_27_Spring_application.pdf
 *   CCGA's Alberta advance rates for 2026 (the rates page's own data)
 *     https://www.ccga.ca/api/AdvanceRate/GetValues?year=2026
 *   Alberta Grains FarmCash, the other Alberta administrator (same Alberta rates)
 *     https://farmcashadvance.com/wp-content/uploads/2026/03/PY2026-Application.pdf
 */

/* ── The program ───────────────────────────────────────────────────────── */

export type ProgramLimits = {
  /** The program year the limits and rates were read for. */
  year: number
  /** The most one producer (with related producers) can have outstanding, every administrator together. */
  maxAdvance: number
  /** The first part of a non-canola advance that carries no interest. */
  interestFree: number
  /** The interest-free limit when canola makes up the rest: $250,000 on anything plus $250,000 more on canola. */
  interestFreeCanola: number
  /** The interest on the rest, in words. */
  interestOnRest: string
}

export const PROGRAM: ProgramLimits = {
  year: 2026,
  maxAdvance: 1_000_000,
  interestFree: 250_000,
  interestFreeCanola: 500_000,
  interestOnRest: 'CCGA charges CIBC prime less 0.25% on the interest-bearing part, worked daily and compounded monthly.',
}

/** The administrator the worksheet is laid out for. */
export const ADMINISTRATOR = {
  name: 'Canadian Canola Growers Association (CCGA)',
  short: 'CCGA',
  apply:
    'CCGA covers grains, oilseeds, pulses and cattle in Alberta. Alberta Grains’ FarmCash and the Feeder Associations of Alberta (WeCAP) are the other Alberta administrators, at the same rates. Apply by email (user-97a5@ccga.ca), fax, phone or CCGA’s portal; the fee is $500.',
  link: 'https://www.ccga.ca/cash-advance',
  phone: '1-866-745-2256',
}

/** The program year's dates, from CCGA's 2026-27 dates (the same rule a year on for a later year). */
export function programDates(year: number) {
  return {
    /** Last day to apply for a post-harvest (stored grain) or fall livestock advance. */
    applyBy: `${year + 1}-03-15`,
    /** An actual-seeded advance is turned into a post-harvest one, or repaid, by then. */
    convertBy: `${year}-12-31`,
    /** Field crops: the production period ends; everything still owing is due. */
    cropsRepayBy: `${year + 1}-09-30`,
    /** Cattle. */
    cattleRepayBy: `${year + 2}-03-31`,
    /** Crop repayments from this day need proof of sale. */
    proofFrom: `${year + 1}-02-01`,
  }
}

/* ── Advance rates ─────────────────────────────────────────────────────── */

export type CropLike = { name: string; category: string | null; own_use?: boolean | null }

/** A commodity on the administrator's rate table, and which of our crops it takes. */
export type Commodity = {
  key: string
  /** As the rate table names it. */
  name: string
  matches: (c: CropLike) => boolean
  /** Dollars a tonne, Alberta, for the program year. Null when the table gives none: never guessed. */
  perTonne: number | null
  /** Why it is not advanced on here. */
  ineligible?: string
  /** What Sam should check about it. */
  confirm?: string
  /** Canola's interest-free limit is the higher one. */
  canola?: boolean
}

const has = (re: RegExp) => (c: CropLike) => re.test(c.name)
export const isSeedCanola = (c: CropLike) => c.category === 'seed' && isCanola(c.name)
const FEED = /\bfeed\b/i

/**
 * CCGA's Alberta rates for 2026, $/tonne (effective 1 April 2026, "subject to
 * change during the production period"). Most particular first: seed canola
 * before canola, silage before corn, durum before wheat, alfalfa seed before
 * alfalfa. Green feed and silage have no line; nor has contract seed canola.
 */
export const COMMODITIES: Commodity[] = [
  {
    key: 'seed-canola',
    name: 'Canola, contract seed',
    matches: isSeedCanola,
    perTonne: null,
    ineligible:
      'Not counted: CCGA’s rate table has no line for contract seed canola, and the program advances only on a crop we own and market; under the BASF, Corteva and Nutrien contracts the company usually holds title. Ask CCGA (1-866-745-2256)',
  },
  { key: 'canola', name: 'Canola', matches: (c) => isCanola(c.name), perTonne: 305.55, canola: true },
  { key: 'silage', name: 'Silage', matches: has(/silage/i), perTonne: null, confirm: 'no silage line on the rate table' },
  { key: 'corn-feed', name: 'Corn – Feed', matches: (c) => /corn/i.test(c.name) && FEED.test(c.name), perTonne: 126.1 },
  { key: 'corn', name: 'Corn', matches: has(/corn/i), perTonne: 127.93, confirm: 'Corn – Feed is $126.10/t if CCGA classes it as feed' },
  { key: 'beans-pinto', name: 'Beans – Pinto', matches: has(/pinto/i), perTonne: 426.8 },
  { key: 'beans-white', name: 'Beans – White', matches: has(/great northern|white|navy/i), perTonne: 426.8, confirm: 'great northern taken as white beans: confirm with CCGA' },
  { key: 'beans-coloured', name: 'Beans – Other Colored', matches: has(/bean/i), perTonne: 485.0, confirm: 'black and yellow beans taken as other coloured: confirm with CCGA' },
  { key: 'durum', name: 'Durum', matches: has(/durum/i), perTonne: 126.1 },
  { key: 'wheat-feed', name: 'Wheat – Feed', matches: (c) => /wheat/i.test(c.name) && FEED.test(c.name), perTonne: 92.15 },
  { key: 'wheat', name: 'Wheat', matches: has(/wheat/i), perTonne: 121.25 },
  { key: 'barley-feed', name: 'Barley – Feed', matches: (c) => /barley/i.test(c.name) && FEED.test(c.name), perTonne: 116.4 },
  { key: 'barley', name: 'Barley', matches: has(/barley/i), perTonne: 121.25, confirm: 'the table has Barley and Barley – Feed only; Barley – Feed is $116.40/t' },
  { key: 'oats', name: 'Oats', matches: has(/\boats?\b/i), perTonne: 126.1 },
  { key: 'triticale', name: 'Triticale', matches: has(/triticale/i), perTonne: 87.3 },
  // $0.679 a pound on the table.
  { key: 'alfalfa-seed', name: 'Alfalfa seed', matches: has(/alfalfa seed/i), perTonne: Math.round(0.679 * LB_PER_TONNE * 100) / 100, confirm: 'the table’s rate is $0.679/lb' },
  { key: 'alfalfa', name: 'Alfalfa', matches: has(/alfalfa/i), perTonne: 87.3 },
  { key: 'green-feed', name: 'Green feed', matches: has(/green ?feed/i), perTonne: null, confirm: 'no green feed line on the rate table' },
  { key: 'hay', name: 'Hay', matches: has(/\bhay\b|grass|timothy/i), perTonne: 77.6 },
]

/** The commodity a crop is advanced as, or null for a crop the table does not list (potatoes, fallow). */
export function commodityFor(c: CropLike): Commodity | null {
  return COMMODITIES.find((x) => x.matches(c)) ?? null
}

/** Grown to feed our own cattle: the program advances only on what is to be sold. */
export const isFedOnFarm = (c: CropLike) => Boolean(c.own_use) || c.category === 'own_use'

/* ── Livestock ─────────────────────────────────────────────────────────── */

export type HerdClass = { class_name: string; feed_class: string | null; avgLb: number | null }

export type LivestockRate = {
  key: string
  name: string
  /** Dollars a head, Alberta, for the program year. */
  perHead: number | null
  /** Breeding stock: only advanced on if it will be sold inside the production period. */
  breeding?: boolean
}

/** CCGA's Alberta cattle rates for 2026, $/head. There is no line for calves under 400 lb. */
export const CATTLE_RATES = {
  feeder400: { key: 'feeder400', name: 'Cattle – Feeder 400–700 lb', perHead: 1907.26 },
  feeder700: { key: 'feeder700', name: 'Cattle – Feeder 700–900 lb', perHead: 1747.94 },
  finished900: { key: 'finished900', name: 'Finished 900–1,250 lb', perHead: 1650.21 },
  finished1250: { key: 'finished1250', name: 'Finished over 1,250 lb', perHead: 2149.04 },
  cow: { key: 'cow', name: 'Cow', perHead: 1649.0, breeding: true },
  bredHeifer: { key: 'bredHeifer', name: 'Bred heifer', perHead: 1746.0, breeding: true },
  heiferCalf: { key: 'heiferCalf', name: 'Heifer calf (breeding)', perHead: 1212.5, breeding: true },
  bull: { key: 'bull', name: 'Bull, mature (over 2 yr)', perHead: 3104.0, breeding: true },
} satisfies Record<string, LivestockRate>

/**
 * The rate a class of the herd is advanced at. Calves and feeders go by
 * their weight; cows, bred heifers, replacement heifer calves and bulls by
 * the breeding-stock lines, which only count if the animals will be sold by
 * the end of the production period.
 */
export function livestockRateFor(c: HerdClass): LivestockRate | null {
  if (c.feed_class === 'bull' || /bull/i.test(c.class_name)) return CATTLE_RATES.bull
  if (c.feed_class === 'cow' || /\bcows?\b/i.test(c.class_name)) return CATTLE_RATES.cow
  if (c.feed_class === 'bred_heifer' || /bred/i.test(c.class_name)) return CATTLE_RATES.bredHeifer
  if (c.feed_class === 'heifer_calf' || /replacement/i.test(c.class_name)) return CATTLE_RATES.heiferCalf
  if (isCalfClass(c) || /feeder|yearling/i.test(c.class_name)) {
    const w = c.avgLb
    if (w == null || w < 400) return null
    if (w < 700) return CATTLE_RATES.feeder400
    if (w < 900) return CATTLE_RATES.feeder700
    if (w <= 1250) return CATTLE_RATES.finished900
    return CATTLE_RATES.finished1250
  }
  return null
}

/* ── Rate maths ────────────────────────────────────────────────────────── */

/** The advance on a quantity at a rate: null when either is not known, never a zero standing in for it. */
export function advanceOn(quantity: number | null, rate: number | null): number | null {
  if (quantity == null || rate == null || !Number.isFinite(quantity) || !Number.isFinite(rate)) return null
  return Math.round(Math.max(quantity, 0) * rate)
}

/**
 * What can still be advanced on: our production less what has gone to a
 * buyer (sold grain is repaid, not advanced on). Null when production is not
 * known. Never below zero.
 */
export function eligibleQuantity(production: number | null, delivered: number | null): number | null {
  if (production == null) return null
  return Math.max(production - (delivered ?? 0), 0)
}

export type Capped = {
  /** Every commodity's advance added up. */
  requested: number
  /** What the program allows of it. */
  allowed: number
  /** The part over the program's maximum. */
  overCap: number
  interestFree: number
  interestBearing: number
}

/**
 * The program's limits on a requested advance: the maximum first, then the
 * interest-free part off the front — up to $250,000 on any commodity and up
 * to $500,000 in all where canola makes up the rest (CCGA assigns the
 * commodities to get the most interest-free). Advances still owing count
 * against both, so they come off first where they are known.
 */
export function capAdvance(requested: { canola: number; other: number }, limits: Pick<ProgramLimits, 'maxAdvance' | 'interestFree' | 'interestFreeCanola'>, owing = 0): Capped {
  const canola = Math.max(requested.canola, 0)
  const other = Math.max(requested.other, 0)
  const total = canola + other
  const allowed = Math.min(total, Math.max(limits.maxAdvance - owing, 0))
  const anyRoom = Math.max(limits.interestFree - owing, 0)
  const fromOther = Math.min(other, anyRoom)
  const canolaRoom = Math.max(limits.interestFreeCanola - owing - fromOther, 0)
  const interestFree = Math.min(allowed, fromOther + Math.min(canola, canolaRoom))
  return { requested: total, allowed, overCap: total - allowed, interestFree, interestBearing: allowed - interestFree }
}

/* ── Production, field by field ────────────────────────────────────────── */

export type AreaLine = {
  area: InsurableArea
  crop: HarvestCrop | null
  unit: string
  /** The whole field's production in the crop's unit: harvested, else expected. */
  production: number | null
  /** Filled (weighed or written down), an estimate (expected yield), or blank. */
  status: Status
  /** Where the figure came from. */
  source: string
  /** Our part of the crop, 0..1. */
  share: number
  /** Whose land deal, for a shared field. */
  with: string | null
  /** Our part, in the crop's unit and in tonnes. */
  ours: number | null
  tonnes: number | null
}

export const lbPerBuOf = (crop: Pick<HarvestCrop, 'name' | 'test_weight_lb_per_bu'> | null) => (crop ? (bushelWeightFor(crop.name, num(crop.test_weight_lb_per_bu))?.lbPerBu ?? null) : null)

const fmt = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: v >= 100 ? 0 : 1 })

/**
 * One crop area's production for the advance: what was harvested where the
 * harvest is recorded (as the AFSC production report declares it), else the
 * plan's acres at its expected yield, marked as an estimate; blank when
 * neither is known. A shared field counts our part only — unless the sheet is
 * the joint venture's own, which applies on the whole field.
 */
export function areaProduction(i: {
  area: InsurableArea
  crop: HarvestCrop | null
  history: HistoryRow | null
  loads: LoadLite[]
  began: DayFrom | null
  deal: LandDeal | null
  /** The joint venture applies in its own name (Sam, 7 Oct 2026), so its sheet counts the whole crop. */
  wholeField?: boolean
}): AreaLine {
  const h = fieldHarvest({ history: i.history, loads: i.loads, unit: i.crop?.yield_unit ?? null, began: i.began })
  const unit = h.unit
  const s = i.wholeField ? { fraction: 1, with: shareOf(i.deal).with } : shareOf(i.deal)
  const acres = i.area.area.acres
  const expected = i.area.area.expectedYield
  let production: number | null = null
  let status: Status = STATUS.blank
  let source: string
  if (h.status === 'harvested' && h.production != null) {
    production = h.production
    status = STATUS.filled
    source = `harvested${h.source ? ` (${h.source})` : ''}`
  } else if (acres != null && expected != null && expected > 0) {
    production = acres * expected
    status = STATUS.estimate
    const why = h.status === 'under_way' ? `harvest not finished, ${fmt(h.soFar ?? 0)} ${unitWord(unit)} weighed so far` : h.status === 'no_production' ? 'harvested, production not recorded' : 'not harvested yet'
    source = `expected ${fmt(expected)} ${unitWord(unit)}/ac × ${fmt(acres)} ac (${why})`
  } else {
    source = acres == null ? 'no acres on the plan' : 'no expected yield for the crop'
  }
  const ours = production == null ? null : production * s.fraction
  return { area: i.area, crop: i.crop, unit, share: s.fraction, with: s.with, production, status, source, ours, tonnes: toTonnes(ours, unit, lbPerBuOf(i.crop)) }
}

/* ── By commodity ──────────────────────────────────────────────────────── */

export const COMMODITY_HEAD = [
  'Commodity',
  'Our crops',
  'Acres',
  'Production (our share)',
  'Unit',
  'Tonnes (our share)',
  'Production is',
  'In bins now (t)',
  'Contracted (t)',
  'Delivered (t)',
  'Unpriced (t)',
  'Eligible (t)',
  'Rate ($/t)',
  'Estimated advance ($)',
  'Check',
]

export type CommodityLine = {
  key: string
  name: string
  commodity: Commodity | null
  canola: boolean
  crops: string[]
  acres: number | null
  production: number | null
  unit: string | null
  tonnes: number | null
  status: Status
  inBins: number | null
  contracted: number | null
  delivered: number | null
  unpriced: number | null
  eligible: number | null
  rate: number | null
  advance: number | null
  notes: string[]
}

const sumOrNull = (xs: (number | null)[]) => (xs.some((x) => x != null) ? xs.reduce<number>((s, x) => s + (x ?? 0), 0) : null)
const r1 = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10)
const r0 = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v))
const prodCell = (v: number | null, unit: string | null) => (unit && ['bu', 'lbs', 'lb'].includes(unit.toLowerCase()) ? r0(v) : r1(v))

/** Production status for a set of fields: blank if none is known, an estimate if any is not weighed, else filled. */
export function combinedStatus(statuses: Status[]): Status {
  if (!statuses.length || statuses.every((s) => s === STATUS.blank)) return STATUS.blank
  if (statuses.some((s) => s !== STATUS.filled)) return STATUS.estimate
  return STATUS.filled
}

/**
 * The fields' production gathered by commodity, with what is in the bins,
 * contracted and delivered (all in tonnes), and the advance at the rate on
 * our tonnes less what was delivered. Every advance is an estimate. A figure
 * the app does not hold is null, so it prints blank; it is never a zero.
 */
export function commodityLines(o: {
  lines: AreaLine[]
  /** Tonnes by crop id; null for a crop that cannot be weighed. Left empty on a joint venture's sheet. */
  binTonnes: Map<string, number | null>
  contracted: Map<string, number | null>
  delivered: Map<string, number | null>
  /** Bins, contracts and deliveries are the whole farm's: only put against our own sheet. */
  farmWide: boolean
}): CommodityLine[] {
  const groups = new Map<string, { c: Commodity | null; fed: boolean; list: AreaLine[] }>()
  for (const l of o.lines) {
    const c = l.crop ? commodityFor(l.crop) : null
    const fed = l.crop ? isFedOnFarm(l.crop) : false
    const key = `${c?.key ?? `crop:${l.area.area.cropId}`}${fed ? ':fed' : ''}`
    const g = groups.get(key) ?? { c, fed, list: [] }
    g.list.push(l)
    groups.set(key, g)
  }
  const out: CommodityLine[] = []
  for (const [key, { c, fed, list }] of groups) {
    const cropIds = [...new Set(list.map((l) => l.area.area.cropId))]
    const crops = [...new Set(list.map((l) => l.area.area.crop))].sort()
    const units = [...new Set(list.map((l) => l.unit))]
    const unit = units.length === 1 ? units[0] : null
    const status = combinedStatus(list.map((l) => l.status))
    const tonnes = sumOrNull(list.map((l) => l.tonnes))
    // A crop held as null (a bin or a ticket that cannot be weighed) makes the total unknown, not short.
    const unknownIn = (m: Map<string, number | null>) => cropIds.some((id) => m.has(id) && m.get(id) === null)
    const pick = (m: Map<string, number | null>) => (!o.farmWide || unknownIn(m) ? null : sumOrNull(cropIds.map((id) => m.get(id) ?? null)))
    const inBins = pick(o.binTonnes)
    const contracted = pick(o.contracted)
    const delivered = pick(o.delivered)
    const ineligible = fed ? 'Not counted: grown to feed our cattle, and the program advances only on what is to be sold. If some will be sold, it can be advanced at its rate' : c?.ineligible
    const notes: string[] = []
    if (ineligible) notes.push(ineligible)
    if (c?.confirm) notes.push(c.confirm)
    if (!c) notes.push('not on CCGA’s rate table: ask CCGA whether it is eligible')
    if (status === STATUS.estimate) notes.push('takes the expected yield on fields not harvested or not weighed: an estimate')
    if (status === STATUS.blank) notes.push('production not known: fill in')
    if (units.length > 1) notes.push(`more than one unit (${units.map(unitWord).join(', ')}): compare in tonnes`)
    const partners = [...new Set(list.map((l) => l.with).filter(Boolean))]
    if (partners.length) notes.push(`shared fields count our part only (${partners.join(', ')})`)
    if (list.some((l) => l.crop?.afsc_insured === false)) notes.push('insured through its contract, not AFSC: a stored crop needs no AFSC cover, an unharvested one does (or AgriStability)')
    if (tonnes != null && list.some((l) => l.tonnes == null && l.production != null)) notes.push('a crop with no bushel weight is left out of the tonnes')
    if (o.farmWide && unknownIn(o.delivered)) notes.push('a delivery could not be weighed, so nothing delivered is taken off: check eligible against the settlements')
    const rate = c && !ineligible ? c.perTonne : null
    const eligible = ineligible ? null : r1(eligibleQuantity(tonnes, delivered))
    if (eligible != null && rate == null && c && !ineligible) notes.push('no rate: ask CCGA')
    out.push({
      key,
      name: fed ? `${c?.name ?? crops.join(', ')} (fed on the farm)` : (c?.name ?? crops.join(', ')),
      commodity: c,
      canola: Boolean(c?.canola),
      crops,
      acres: sumOrNull(list.map((l) => l.area.area.acres)),
      production: unit ? sumOrNull(list.map((l) => l.ours)) : null,
      unit,
      tonnes,
      status,
      inBins,
      contracted,
      delivered,
      unpriced: o.farmWide && tonnes != null ? Math.max(tonnes - (contracted ?? 0), 0) : null,
      eligible,
      rate,
      advance: advanceOn(eligible, rate),
      notes,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function commodityRow(l: CommodityLine): Cell[] {
  return [
    l.name,
    l.crops.join(', '),
    r1(l.acres),
    prodCell(l.production, l.unit),
    l.production != null && l.unit ? unitWord(l.unit) : null,
    r1(l.tonnes),
    l.status,
    r1(l.inBins),
    r1(l.contracted),
    r1(l.delivered),
    r1(l.unpriced),
    l.eligible,
    l.rate,
    l.advance,
    l.notes.join('; ') || null,
  ]
}

/* ── Livestock ─────────────────────────────────────────────────────────── */

export const LIVESTOCK_HEAD = ['Ranch', 'Class', 'Head', 'Avg weight (lb)', 'Advanced as', 'Rate ($/head)', 'Estimated advance ($)', 'Advance is', 'Check']

export type HerdLine = { ranch: string; class_name: string; feed_class: string | null; head: number; avgLb: number | null }

/**
 * Head by class at the per-head rates. Feeder and finished cattle count;
 * breeding stock shows its rate but is left out of the total (the program
 * only advances on animals to be sold in the production period).
 */
export function livestockLines(herd: HerdLine[], cattleRepayBy: string): { rows: Cell[][]; advance: number | null; head: number } {
  let total: number | null = null
  let head = 0
  const rows = herd
    .filter((h) => h.head > 0)
    .map((h): Cell[] => {
      head += h.head
      const r = livestockRateFor(h)
      const counted = r != null && !r.breeding
      const adv = counted ? advanceOn(h.head, r.perHead) : null
      if (adv != null) total = (total ?? 0) + adv
      const check = !r
        ? h.avgLb == null
          ? 'no average weight: the rate goes by weight'
          : h.avgLb < 400
            ? 'under 400 lb: no rate on the table'
            : 'no rate for this class'
        : r.breeding
          ? `Not counted: breeding stock is advanced on only if it will be sold by ${longDate(cattleRepayBy)}`
          : 'At foot now; the advance needs 2026 AgriStability'
      return [h.ranch, h.class_name, h.head, h.avgLb, r?.name ?? null, r?.perHead ?? null, adv, adv != null ? STATUS.estimate : r?.breeding ? STATUS.na : STATUS.blank, check]
    })
  return { rows, advance: total, head }
}

/* ── The form's own lines ──────────────────────────────────────────────── */

export const LINE_HEAD = ['Item', 'Value', 'Status', 'From the app, or what to fill in']

export type Line = [item: string, value: Cell, status: Status, note: string]

export const blankLine = (item: string, note: string): Line => [item, null, STATUS.blank, note]
/** A value the app holds; with nothing to show, a blank, never a zero. */
export const valueLine = (item: string, value: number | string | null, status: Status, note: string, ifBlank: string): Line =>
  value == null || value === '' ? blankLine(item, ifBlank) : [item, value, status, note]

const money = (v: number) => `$${Math.round(v).toLocaleString('en-CA')}`

/** The advance worked through the program's limits, line by line. */
export function advanceLines(o: { canola: number | null; otherCrops: number | null; livestock: number | null; limits: ProgramLimits }): Line[] {
  const crops = sumOrNull([o.canola, o.otherCrops])
  const requested = sumOrNull([crops, o.livestock])
  const c = requested == null ? null : capAdvance({ canola: o.canola ?? 0, other: (o.otherCrops ?? 0) + (o.livestock ?? 0) }, o.limits)
  return [
    valueLine('Estimated advance on crops', crops, STATUS.estimate, `Each commodity’s eligible tonnes × its rate (by commodity, below)${o.canola ? `; canola ${money(o.canola)}` : ''}.`, 'No crop has both a production figure and a rate.'),
    valueLine('Estimated advance on cattle', o.livestock, STATUS.estimate, 'Feeder calves by weight class × the rate a head (livestock, below). Breeding stock is not counted.', 'No herd counts, or no class with a rate.'),
    valueLine('Total before the program’s limits', requested, STATUS.estimate, 'Crops and cattle together.', 'Nothing to add up yet.'),
    ['Program maximum', o.limits.maxAdvance, STATUS.filled, `The most a producer and its related producers can have outstanding, every administrator and the ${o.limits.year - 1} and ${o.limits.year} advances together.`],
    blankLine('Advances still owing (any administrator, any program year)', 'Not kept in the app. It comes off the maximum and the interest-free part.'),
    valueLine('Estimated advance within the maximum', c ? c.allowed : null, STATUS.estimate, c && c.overCap > 0 ? `${money(c.overCap)} over the maximum is left off.` : 'Under the maximum, before any advance still owing.', 'Nothing to add up yet.'),
    ['Interest-free limit', o.limits.interestFree, STATUS.filled, `The first ${money(o.limits.interestFree)} carries no interest; up to ${money(o.limits.interestFreeCanola)} where canola makes up the rest.`],
    valueLine('Interest-free part', c ? c.interestFree : null, STATUS.estimate, 'Before any advance still owing, which uses up the interest-free part first.', 'Nothing to add up yet.'),
    valueLine('Interest-bearing part', c ? c.interestBearing || null : null, STATUS.estimate, o.limits.interestOnRest, c ? 'None: the whole estimate is inside the interest-free limit.' : 'Nothing to add up yet.'),
  ]
}

/* ── Repayment ─────────────────────────────────────────────────────────── */

export const REPAY_HEAD = ['Commodity', 'Repay by', 'When you sell', 'Proof of sale']
export const DELIVERY_HEAD = ['Date', 'Buyer', 'Ticket no.', 'Commodity', 'Crop', 'Net tonnes', 'Rate ($/t)', 'Repay on it ($)', 'Status', 'How it was weighed']

export function repaymentRules(year: number) {
  const d = programDates(year)
  return {
    onSale: 'Within 30 days of being paid: at least the tonnes sold × the advance rate. A grain buyer can send it to CCGA straight off the cheque.',
    cattleOnSale: 'Within 30 days of being paid: at least the head sold × the advance rate.',
    cropProof: `Not needed for repayments up to ${longDate(`${year + 1}-01-31`)}; from ${longDate(d.proofFrom)} the settlement or cash ticket: date, seller and buyer with their contacts, the product, quantity and net paid. Upload it in CCGA’s portal or send it to user-66f4@ccga.ca. Repaying more than $10,000 (or 10% of the advance, if more) without proof of sale is charged interest.`,
    cattleProof: 'Every sale: the settlement, with the date, seller and buyer, head and net paid.',
    cropsBy: `${longDate(d.cropsRepayBy)} (end of the production period)`,
    cattleBy: `${longDate(d.cattleRepayBy)}; continuous-flow cattle within 12 months of the advance if sooner`,
  }
}

/** Each delivery in the app with what an advance on it would ask back (an estimate: the rate × the net tonnes). */
export function deliveryRows(sales: (Sale & { cropName: string })[], cropOf: (name: string) => CropLike | null): { rows: Cell[][]; repay: number | null } {
  let repay: number | null = null
  const rows = sales.map((s): Cell[] => {
    const crop = cropOf(s.cropName)
    const c = crop ? commodityFor(crop) : null
    const rate = c && !c.ineligible && !(crop && isFedOnFarm(crop)) ? c.perTonne : null
    const owe = advanceOn(s.tonnes, rate)
    if (owe != null) repay = (repay ?? 0) + owe
    return [s.date, s.buyer, s.ticket, c?.name ?? null, s.cropName, s.tonnes == null ? null : Math.round(s.tonnes * 1000) / 1000, rate, owe, owe != null ? STATUS.estimate : STATUS.blank, s.basis.split(';')[0]]
  })
  return { rows, repay }
}

/* ── The report ────────────────────────────────────────────────────────── */

export const FIELD_HEAD = ['Field', 'Legal land', 'Crop', 'Variety', 'Acres', 'Land', 'Insured', 'Production (whole field)', 'Unit', 'Production is', 'From', 'Our share (%)', 'Our tonnes']
/** A joint venture's own sheet: it applies on the whole crop. */
export const JV_FIELD_HEAD = [...FIELD_HEAD.slice(0, -2), 'Applied on (%)', 'Tonnes']
export const JV_HEAD = ['Joint venture with', 'Commodity', 'Crops', 'Acres', 'Tonnes (whole field)', 'Production is', 'Rate ($/t)', 'The joint venture’s advance ($)', 'Check']
export const STORAGE_HEAD = ['Bin', 'Site', 'Crop', 'Commodity', 'Bushels', 'Tonnes']
export const NEEDED_HEAD = ['Still needed', 'Where it comes from']

export type BinRow = { bin: string; site: string | null; cropId: string; crop: string; bushels: number; tonnes: number | null }

export type CashAdvanceInput = {
  year: number
  today: string
  farmName: string
  /** '' for our own fields, else the joint venture's landlord. */
  party: string
  lines: AreaLine[]
  left: string[]
  /** The joint ventures' fields, on our own sheet: each may be its own applicant. */
  ventures: { landlord: string; lines: AreaLine[] }[]
  binRows: BinRow[]
  contracted: Map<string, number | null>
  delivered: Map<string, number | null>
  herd: HerdLine[]
  sales: (Sale & { cropName: string })[]
  cropByName: Map<string, CropLike>
}

const pct = (f: number) => Math.round(f * 1000) / 10

/** Tonnes in the bins by crop; one bin that cannot be weighed makes its crop's total unknown, not short. */
export function binTonnesByCrop(rows: BinRow[]): Map<string, number | null> {
  const m = new Map<string, number | null>()
  for (const b of rows) {
    const prev = m.get(b.cropId)
    m.set(b.cropId, prev === null || b.tonnes == null ? null : (prev ?? 0) + b.tonnes)
  }
  return m
}

export function cashAdvanceReport(inp: CashAdvanceInput): SectionedReport & { rows: number } {
  const own = !inp.party
  const dates = programDates(inp.year)
  const rules = repaymentRules(inp.year)
  const lines = commodityLines({ lines: inp.lines, binTonnes: binTonnesByCrop(inp.binRows), contracted: inp.contracted, delivered: inp.delivered, farmWide: own })
  const canola = sumOrNull(lines.filter((l) => l.canola).map((l) => l.advance))
  const otherCrops = sumOrNull(lines.filter((l) => !l.canola).map((l) => l.advance))
  const herd = own ? livestockLines(inp.herd, dates.cattleRepayBy) : { rows: [], advance: null, head: 0 }
  const adv = advanceLines({ canola, otherCrops, livestock: herd.advance, limits: PROGRAM })
  const otherYear = PROGRAM.year !== inp.year ? `The rates and limits here are CCGA’s for program year ${PROGRAM.year}; ${inp.year}’s may differ: check them.` : null

  const form: Line[] = [
    ['Program year', inp.year, STATUS.filled, 'The crop year picked on the row.'],
    ['Administrator', ADMINISTRATOR.name, STATUS.estimate, ADMINISTRATOR.apply],
    ['Advance type', 'Post-harvest (stored grain); cattle at foot', STATUS.estimate, `Spring applications closed in June. A stored-grain or fall cattle advance can be applied for until ${longDate(dates.applyBy)}; an actual-seeded advance must become post-harvest or be repaid by ${longDate(dates.convertBy)}.`],
    valueLine(
      'Applicant (farm) name',
      own ? inp.farmName : `${inp.farmName} and ${inp.party} (joint venture)`,
      STATUS.filled,
      own ? 'Farm setup.' : 'The joint venture applies in its own name, as a partnership, on the whole crop; every partner signs. CCGA confirms how much of it counts against our limit.',
      'Set the farm name under Settings, Farm setup.',
    ),
    blankLine('Business structure (individual, partnership, corporation)', 'Partnerships and corporations also sign the joint and several liability form and send proof of the partnership or the shareholder ledger. Not kept in the app.'),
    blankLine('Owners, partners or shareholders and their shares', 'Names and percentages; each new one sends photo ID. Not kept in the app.'),
    blankLine('Mailing address, phone and email', 'Not kept in the app.'),
    blankLine('SIN or business number', 'Never filled by the app.'),
    blankLine('AgriStability participant number (PIN), 2026 enrolment', 'Never filled by the app. Cattle advances need 2026 AgriStability with the fee paid.'),
    blankLine('AFSC AgriInsurance client and contract numbers', 'Never filled by the app. From the Statement of Coverage; only needed for a crop not yet harvested.'),
    blankLine('Insured production by crop (t/ac) for anything not yet harvested', 'An unharvested crop is advanced on up to its insured production. From the Statement of Coverage.'),
    blankLine('Advances still owing (any administrator, any program year)', 'Not kept in the app.'),
    blankLine('Lenders and suppliers holding security on crops or cattle', 'Each signs a priority agreement for CCGA; without them CCGA runs a lien search, which is slower. Not kept in the app.'),
    blankLine('Related producers', 'Spouses, and farms one owns 25% or more of, share one limit. Every applicant fills in the declaration. Not kept in the app.'),
    blankLine('Multi-peril insurance on the stored grain and cattle', 'CCGA asks for an attestation. Not kept in the app.'),
    blankLine('Bank account for the deposit', 'Not kept in the app.'),
  ]

  const fieldRows: Cell[][] = [...inp.lines]
    .sort((a, b) => a.area.area.crop.localeCompare(b.area.area.crop) || compareFieldNames(a.area.field.name, b.area.field.name))
    .map((l) => [
      l.area.field.name,
      l.area.field.legal_land_description,
      l.area.area.crop,
      l.area.area.variety,
      r1(l.area.area.acres),
      l.area.irrigated ? 'Irrigated' : 'Dryland',
      l.crop?.afsc_insured === false ? 'Contract' : 'AFSC',
      prodCell(l.production, l.unit),
      l.production != null ? unitWord(l.unit) : null,
      l.status,
      l.source,
      pct(l.share),
      r1(l.tonnes),
    ])

  const ventureRows: Cell[][] = inp.ventures.flatMap((v) =>
    commodityLines({ lines: v.lines, binTonnes: new Map(), contracted: new Map(), delivered: new Map(), farmWide: false }).map((c): Cell[] => [
      v.landlord,
      c.name,
      c.crops.join(', '),
      r1(c.acres),
      r1(c.tonnes),
      c.status,
      c.rate,
      c.advance,
      [c.commodity?.ineligible ?? null, 'Its own application, not in this sheet’s totals; less anything already delivered. Pick it under “Report for” for its sheet.'].filter(Boolean).join('; '),
    ]),
  )

  const cropOf = (name: string) => inp.cropByName.get(name) ?? null
  const deliveries = own ? deliveryRows(inp.sales, cropOf) : { rows: [], repay: null }
  const repayRows: Cell[][] = lines.filter((l) => l.advance != null).map((l) => [l.name, rules.cropsBy, rules.onSale, rules.cropProof])
  if (herd.advance != null) repayRows.push(['Cattle', rules.cattleBy, rules.cattleOnSale, rules.cattleProof])

  const needed: Cell[][] = [
    ...form.filter((l) => l[2] === STATUS.blank).map((l): Cell[] => [l[0], l[3]]),
    ...lines.filter((l) => l.status === STATUS.blank).map((l): Cell[] => [`Production of ${l.name}`, 'Weigh the loads or write the yield on Harvest, or set an expected yield on Crop settings.']),
    ...lines
      .filter((l) => l.status === STATUS.estimate && l.advance != null)
      .map((l): Cell[] => [`Harvested production of ${l.name} (an estimate now)`, 'Mark the last load off each field on Harvest; CCGA advances on what is in storage.']),
    ...lines.filter((l) => l.tonnes != null && l.rate == null && !l.commodity?.ineligible && !l.name.endsWith('(fed on the farm)')).map((l): Cell[] => [`Advance rate for ${l.name}`, `Ask CCGA, ${ADMINISTRATOR.phone}.`]),
    ...lines.filter((l) => l.commodity?.key === 'seed-canola').map((l): Cell[] => [`Whether ${l.crops.join(', ')} can be advanced on`, `Ask CCGA, ${ADMINISTRATOR.phone}: who holds title under the seed contract.`]),
    ...(own && inp.ventures.length ? [[`How much of each joint venture’s advance counts against our limit (${inp.ventures.map((v) => v.landlord).join(', ')})`, `Ask CCGA, ${ADMINISTRATOR.phone}: related producers share one limit — half, or all of it.`] as Cell[]] : []),
    ...(otherYear ? [[`Program year ${inp.year} rates and limits`, ADMINISTRATOR.link] as Cell[]] : []),
  ]

  const totalTonnes = sumOrNull(lines.map((l) => l.tonnes))
  const sections: ReportSection[] = [
    { title: 'For the application', note: 'In the order of CCGA’s 2026-27 application. This is a worksheet to copy from, not the administrator’s form.', head: LINE_HEAD, rows: form },
    { title: 'The advance', note: 'Every advance figure is an estimate: CCGA works the real one from the quantity in storage (or insured) and its rates on the day.', head: LINE_HEAD, rows: adv },
    {
      title: 'By commodity',
      note: own
        ? 'Our own fields. Tonnes are our share. In bins, contracted and delivered are the whole farm’s (the grain ledger, Markets, the buyers’ tickets), so a joint venture’s grain through our scale is in them. Eligible is our tonnes less what was delivered: contracted grain still in the bin can be advanced on.'
        : `The joint venture with ${inp.party}: the whole of its fields, since it applies in its own name. Bins, contracts and deliveries are not split by field in the app, so they are blank here; take them off the joint venture’s own records.`,
      head: COMMODITY_HEAD,
      rows: lines.map(commodityRow),
      foot: ['Total', null, r1(sumOrNull(lines.map((l) => l.acres))), null, null, r1(totalTonnes), combinedStatus(lines.map((l) => l.status)), r1(sumOrNull(lines.map((l) => l.inBins))), r1(sumOrNull(lines.map((l) => l.contracted))), r1(sumOrNull(lines.map((l) => l.delivered))), r1(sumOrNull(lines.map((l) => l.unpriced))), r1(sumOrNull(lines.map((l) => l.eligible))), null, sumOrNull([canola, otherCrops]), null],
      empty: 'No crop on these fields this year.',
    },
    { title: 'By field', note: 'Production is the harvest where it is recorded, else the plan’s acres at the expected yield (an estimate).', head: own ? FIELD_HEAD : JV_FIELD_HEAD, rows: fieldRows, empty: 'No fields.' },
  ]
  if (own) {
    sections.push({
      title: 'Grain in storage now',
      note: `This crop year’s grain in each bin on ${longDate(inp.today)}, from the grain ledger: the stored quantity a post-harvest advance is on, and what CCGA may inspect. Earlier years’ grain is on the Grain inventory report.`,
      head: STORAGE_HEAD,
      rows: inp.binRows.map((b) => {
        const crop = inp.cropByName.get(b.crop)
        return [b.bin, b.site, b.crop, crop ? (commodityFor(crop)?.name ?? null) : null, Math.round(b.bushels), r1(b.tonnes)]
      }),
      empty: 'Nothing from this crop year is in a bin.',
    })
    sections.push({
      title: 'Cattle',
      note: `The Herd tab’s counts now. Feeder calves count at the rate for their weight; cows, bred heifers, replacements and bulls show the breeding-stock rate but are not counted, as the program advances only on animals to be sold by ${longDate(dates.cattleRepayBy)}.`,
      head: LIVESTOCK_HEAD,
      rows: herd.rows,
      foot: herd.rows.length ? ['Total', null, herd.head, null, null, null, herd.advance, herd.advance != null ? STATUS.estimate : null, null] : undefined,
      empty: 'No herd counts entered (Herd).',
    })
    sections.push({
      title: 'Joint ventures',
      note: 'Each 50/50 joint venture applies in its own name, as a partnership, on its whole crop: these are its applications, not counted above. As related producers part of each may count against our limit: CCGA says how much.',
      head: JV_HEAD,
      rows: ventureRows,
      empty: 'No joint venture fields this year.',
    })
  }
  sections.push({
    title: 'Repayment',
    note: `Repay as you sell. Everything still owing on crops is due ${rules.cropsBy}; on cattle ${rules.cattleBy}. Payments go to the interest-free part first. An advance not repaid on time loses its interest-free benefit and is charged prime plus 1% to 3%.`,
    head: REPAY_HEAD,
    rows: repayRows,
    empty: 'No advance worked out, so nothing to repay.',
  })
  if (own) {
    sections.push({
      title: 'Deliveries in the app',
      note: 'This crop year’s deliveries: the buyers’ tickets, else our own weights. Repay on it is what an advance on that grain would ask back at the rate (an estimate). Its settlement is the proof of sale.',
      head: DELIVERY_HEAD,
      rows: deliveries.rows,
      foot: deliveries.rows.length ? ['Total', null, `${deliveries.rows.length} deliver${deliveries.rows.length === 1 ? 'y' : 'ies'}`, null, null, r1(sumOrNull(inp.sales.map((s) => s.tonnes))), null, deliveries.repay, null, null] : undefined,
      empty: 'No deliveries recorded for this crop year.',
    })
  }
  sections.push({ title: 'Still needed', head: NEEDED_HEAD, rows: needed, empty: 'Nothing.' })
  sections.push({
    title: 'Not on this worksheet',
    head: ['Field or crop', 'Why'],
    rows: inp.left.map((l) => {
      const m = /^(.*) \((.*)\)$/.exec(l)
      return m ? [m[1], m[2]] : [l, null]
    }),
    empty: 'Nothing left off.',
  })

  const within = adv.find((l) => l[0] === 'Estimated advance within the maximum')?.[1]
  const free = adv.find((l) => l[0] === 'Interest-free part')?.[1]
  return {
    title: 'Cash advance application (APP)',
    subtitle: `Program year ${inp.year} · ${partyLabel(inp.party)} · worksheet for ${ADMINISTRATOR.short}, not its form`,
    meta: [
      ['Administrator', ADMINISTRATOR.short],
      ['Commodities', lines.length],
      [own ? 'Our tonnes' : 'Tonnes (the whole crop)', totalTonnes == null ? '—' : `${Math.round(totalTonnes).toLocaleString('en-CA')} t`],
      ['Estimated advance', typeof within === 'number' ? money(within) : '—'],
      ['Interest-free (est.)', typeof free === 'number' ? money(free) : '—'],
      ['Apply by', longDate(dates.applyBy)],
    ],
    lead: [
      `The federal Advance Payments Program lends up to ${money(PROGRAM.maxAdvance)} against crops and cattle, at up to half their expected value. In ${PROGRAM.year} the first ${money(PROGRAM.interestFree)} is interest-free (up to ${money(PROGRAM.interestFreeCanola)} where canola makes up the rest). In Alberta it is run by CCGA, Alberta Grains’ FarmCash and the Feeder Associations of Alberta.`,
      'This worksheet follows CCGA’s application to copy from; it is not CCGA’s form. Production is the harvest where it is recorded, else the expected yield, marked as an estimate. Every advance is an estimate. Blank means the app does not hold it: fill it in. Identifiers are never filled.',
      'Each 50/50 joint venture is apart: pick it under “Report for” for its own sheet. Contract seed canola and crops fed on the farm are listed but not counted.',
      ...(otherYear ? [otherYear] : []),
    ],
    orientation: 'landscape',
    sections,
    filename: `Cash advance APP ${inp.year}${inp.party ? ` ${inp.party} JV` : ''}`,
    rows: inp.lines.length,
  }
}

/* ── The gather ─────────────────────────────────────────────────────────── */

/**
 * The season's crop areas on our own sheet or a joint venture's — the AFSC
 * reports' list (afsc.ts insurableAreas), except that a crop insured through
 * its contract stays on and is flagged, since a stored crop needs no AFSC
 * cover for an advance.
 */
export function advanceAreas(basics: Pick<SeasonBasics, 'fields' | 'areas' | 'irrigated' | 'seeded' | 'rentedOut'>, ins: InsuranceContext): { kept: InsurableArea[]; left: string[] } {
  return insurableAreas(basics, { ...ins, uninsured: new Set() })
}

/** A crop area's production line, from the harvest records and the land deals. */
function linesFrom(rec: HarvestRecords, basics: SeasonBasics, deals: LandDeal[], year: number, wholeField = false) {
  const cropById = new Map(rec.crops.map((c) => [c.id, c]))
  return (a: InsurableArea): AreaLine =>
    areaProduction({
      area: a,
      crop: cropById.get(a.area.cropId) ?? null,
      history: rec.history.find((h) => h.field_id === a.field.id && h.crop_id === a.area.cropId) ?? null,
      loads: rec.loads.filter((l) => l.field_id === a.field.id && l.crop_id === a.area.cropId),
      began: basics.harvested.get(a.field.id) ?? null,
      deal: dealFor(deals, a.field.id, year, a.area.cropId),
      wholeField,
    })
}

export async function gatherCashAdvance(p: ParamValues, ctx: GatherContext): Promise<SectionedReport> {
  const year = yearParam(p, ctx)
  const party = p.insured ?? ''
  const [basics, ins, rec, positions, contracts, contacts, herd, ranches] = await Promise.all([
    loadSeasonBasics(year),
    loadInsuranceContext(year, party),
    loadHarvestRecords(year),
    supabase.from('crop_position').select('*').eq('crop_year', year),
    fetchAll<{ id: string; buyer_contact_id: string | null; contract_number: string | null; price_per_unit: unknown }>((a, b) => supabase.from('contracts').select('id, buyer_contact_id, contract_number, price_per_unit').order('id').range(a, b)),
    fetchAll<{ id: string; company: string | null; contact_name: string | null }>((a, b) => supabase.from('contacts').select('id, company, contact_name').order('id').range(a, b)),
    fetchAll<{ id: string; ranch_id: string | null; class_name: string; head_count: number; avg_weight_lb: unknown; feed_class: string | null; sort_order: number | null }>((a, b) =>
      supabase.from('herd_counts').select('id, ranch_id, class_name, head_count, avg_weight_lb, feed_class, sort_order').order('id').range(a, b),
    ),
    fetchAll<{ id: string; name: string; sort_order: number | null }>((a, b) => supabase.from('ranches').select('id, name, sort_order').order('sort_order').order('id').range(a, b)),
  ])
  if (positions.error) throw new Error(positions.error.message)
  const { kept, left } = advanceAreas(basics, ins)
  if (!kept.length) throw new Error(party ? `Nothing is seeded on the joint venture with ${party} for ${year}.` : `No crop is seeded on an active field for ${year}.`)
  // A joint venture's own sheet is its application: the whole field, not our half.
  const lineOf = linesFrom(rec, basics, ins.deals, year, Boolean(party))
  const ventureLineOf = linesFrom(rec, basics, ins.deals, year, true)

  // Our own sheet names each joint venture's fields apart, never in its totals.
  const ventures = party
    ? []
    : [...new Set(ins.deals.filter((d) => d.direction !== 'out' && d.arrangement === 'profit_share').map((d) => d.landlord))]
        .sort()
        .map((landlord) => ({ landlord, lines: advanceAreas(basics, { ...ins, party: landlord }).kept.map(ventureLineOf) }))
        .filter((v) => v.lines.length)

  const cropById = new Map(rec.crops.map((c) => [c.id, c]))
  // Contracts are in the crop's own unit (the Markets position).
  const contracted = new Map<string, number | null>()
  for (const x of (positions.data ?? []).map(toPosition)) {
    const crop = cropById.get(x.cropId)
    if (crop && x.contracted) contracted.set(x.cropId, toTonnes(x.contracted, crop.yield_unit, lbPerBuOf(crop)))
  }

  // The bins hold bushels whatever the crop is sold in.
  const binById = new Map(rec.bins.map((b) => [b.id, b]))
  const binRows: BinRow[] = binLines(rec.moves, [], ctx.today)
    .filter((l) => l.cropYear === year && l.cropId && (l.bu ?? 0) > 0)
    .map((l) => {
      const crop = cropById.get(l.cropId!)
      const lb = lbPerBuOf(crop ?? null)
      return { bin: binById.get(l.binId)?.name ?? 'Bin', site: binById.get(l.binId)?.site ?? null, cropId: l.cropId!, crop: crop?.name ?? 'Crop not set', bushels: l.bu!, tonnes: lb == null ? null : convertMass(l.bu!, 'bu', 't', lb) }
    })
    .sort((a, b) => a.bin.localeCompare(b.bin, undefined, { numeric: true }))

  // Deliveries counted once each, as the check-off and deliveries reports count them.
  const siteById = new Map(rec.sites.map((s) => [s.id, s.name]))
  const contactById = new Map(contacts.map((c) => [c.id, c.company ?? c.contact_name]))
  const sales = grainSales(
    { tickets: rec.tickets, loads: rec.loads.filter((l) => l.delivery_site_id), moves: rec.moves.filter((m) => m.movement_type === 'delivery_out'), contracts, crops: rec.crops, prices: [] },
    { buyer: (id) => (id ? (contactById.get(id) ?? null) : null), site: (id) => (id ? (siteById.get(id) ?? null) : null), currentYear: ctx.cropYear },
  )
  const idByName = new Map(rec.crops.map((c) => [c.name, c.id]))
  const delivered = new Map<string, number | null>()
  for (const s of sales) {
    const id = idByName.get(s.cropName)
    if (!id) continue
    const prev = delivered.get(id)
    delivered.set(id, prev === null || s.tonnes == null ? null : (prev ?? 0) + s.tonnes)
  }

  const ranchName = new Map(ranches.map((r) => [r.id, r.name]))
  const ranchOrder = new Map(ranches.map((r, i) => [r.id, i]))
  const herdLines: HerdLine[] = [...herd]
    .sort((a, b) => (ranchOrder.get(a.ranch_id ?? '') ?? 99) - (ranchOrder.get(b.ranch_id ?? '') ?? 99) || (a.sort_order ?? 99) - (b.sort_order ?? 99))
    .map((h) => ({ ranch: ranchName.get(h.ranch_id ?? '') ?? 'No ranch', class_name: h.class_name, feed_class: h.feed_class, head: Number(h.head_count) || 0, avgLb: num(h.avg_weight_lb) }))

  const { rows, ...report } = cashAdvanceReport({
    year,
    today: ctx.today,
    farmName: farmBrand().farmName,
    party,
    lines: kept.map(lineOf),
    left,
    ventures,
    binRows,
    contracted,
    delivered,
    herd: herdLines,
    sales,
    cropByName: new Map(rec.crops.map((c) => [c.name, c])),
  })
  if (!rows) throw new Error(`Every crop on the ${year} plan is someone else’s.`)
  return report
}
