import { cropMargin, type MarginInputs } from './rotation-margins'

/**
 * Water against yield and dollars, per field, for one season.
 *
 * Everything here is arithmetic on rows already fetched; the screen is
 * src/pages/irrigation/WaterSeasonReview.tsx.
 *
 *   water      gross = Σ irrigation_events.gross_mm; effective = gross × the
 *              pivot's application efficiency (0.85 when none is on file);
 *              rain and crop use (ETc) from the actual days of the balance
 *   yield      crop_history (harvested: scale loads, Deere, Farm at Hand, typed)
 *              → the plan's yield (crop_plans.yield_per_acre_override)
 *              → the crop's default; the row says which
 *   pumping    hours = acre-inches × 27,154 gal ÷ (gpm × 60);
 *              kW = hp × 0.7457 ÷ 0.9 motor efficiency; $ = kW × hours × $/kWh.
 *              The farm sells solar power and mostly makes more than it
 *              buys, so a kWh a pump uses is a kWh not sold: it is valued at
 *              the sell price by default ($0.35), with the grid price ($0.85)
 *              shown beside it for power that does come off the grid.
 *   value      yield × price, the price from the rotation margins' chain
 *              (contract → target → Alberta market → last target)
 */

export const MM_PER_IN = 25.4
export const GAL_PER_ACRE_INCH = 27_154
export const KW_PER_HP = 0.7457
export const MOTOR_EFFICIENCY = 0.9
export const DEFAULT_APPLICATION_EFFICIENCY = 0.85
/** What solar power sells for, $/kWh (Sam, Oct 2026): the income a pump forgoes. */
export const DEFAULT_POWER_SELL_KWH = 0.35
/** What grid power costs, $/kWh (Sam, 6 Oct 2026: "We pay $0.085 per kwh"). The pumps pay it: the solar is not at the pump sites. */
export const DEFAULT_POWER_BUY_KWH = 0.085
export const DEFAULT_POWER_COST_KWH = DEFAULT_POWER_BUY_KWH
const LS_PER_GPM = 0.0630902

/** "What this says" thresholds. */
export const RULES = {
  /** Days the soil sat at or past the irrigate trigger before it counts as a lot. */
  stressDaysHigh: 7,
  /** Irrigation over this share of the crop's farm average is "high". */
  waterHigh: 1.15,
  waterLow: 0.85,
  /** % of the crop's farm average yield. */
  yieldLow: 92,
  yieldHigh: 108,
}

type Num = number | string | null | undefined
const num = (v: Num): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const pos = (v: Num): number | null => {
  const n = num(v)
  return n != null && n > 0 ? n : null
}

export type ReviewBalanceRow = {
  field_id: string
  zone_id: string | null
  date: string
  is_forecast?: boolean
  rainfall_mm: Num
  etc_mm: Num
  status: string | null
  ks: Num
  dr_mm: Num
  raw_mm: Num
}

export type ReviewData = {
  year: number
  seasons: { field_id: string; zone_id: string | null; application_efficiency: Num }[]
  fields: { id: string; name: string }[]
  plans: { field_id: string; crop_id: string; planned_acres: Num; yield_per_acre_override: Num; yield_basis: string | null }[]
  history: { field_id: string; crop_id: string; acres: Num; yield_per_acre: Num; yield_unit: string | null; source: string }[]
  crops: { id: string; name: string; color: string | null; yield_unit: string | null; default_yield_per_acre: Num; margin_per_acre?: Num; own_use?: boolean | null }[]
  pivots: { field_id: string; acres_irrigated: Num; gpm: Num; system_capacity_ls: Num; application_efficiency: Num; pump_id: string | null }[]
  pumps: { id: string; name: string; horse_power: Num; gpm: Num }[]
  /** FieldNET's reported flow per field (raw->>'reporting_flow'), taken as US gpm. */
  fieldnetFlow: { field_id: string | null; flow: Num }[]
  events: { field_id: string; gross_mm: Num; net_mm: Num }[]
  balance: ReviewBalanceRow[]
  prices: MarginInputs['prices']
  contracts: MarginInputs['contracts']
  market: MarginInputs['market']
  today: string
}

export type YieldKind = 'actual' | 'estimate'

export type WaterReviewRow = {
  fieldId: string
  fieldName: string
  cropId: string | null
  cropName: string
  cropColor: string | null
  /** More than one crop on the field this year: the largest is shown. */
  split: boolean
  acres: number | null
  events: number
  grossMm: number
  efficiency: number
  effectiveMm: number
  /** Days of actual water balance behind rain, ETc and stress. */
  balanceDays: number
  rainMm: number | null
  etcMm: number | null
  /** Actual days the balance said "irrigate now" or "water stress". */
  stressDays: number | null
  /** Actual days the root zone was dried past the readily available water (Ks < 1). */
  belowThresholdDays: number | null
  irrigationIn: number
  totalWaterIn: number | null
  yield: number | null
  yieldUnit: string | null
  yieldKind: YieldKind | null
  /** Far from the crop's default: typed in another unit. Shown, not valued or compared. */
  yieldSuspect: boolean
  yieldFrom: string
  /** Yield per inch of total water (effective irrigation + rain). */
  yieldPerInTotal: number | null
  /** Yield per gross inch of irrigation. */
  yieldPerInIrrigation: number | null
  /** % of this crop's acre-weighted farm average this year. */
  relYield: number | null
  gpm: number | null
  gpmFrom: string | null
  hp: number | null
  acreInches: number | null
  pumpHours: number | null
  kwh: number | null
  pumpCost: number | null
  pumpCostPerAc: number | null
  pumpCostPerAcIn: number | null
  /** Why the pumping cost could not be worked out, or a caution about it. */
  pumpNote: string | null
  price: number | null
  priceFrom: string
  grossPerAc: number | null
  dollarsPerInIrrigation: number | null
  verdict: string
}

/** Pumping cost for one field. Missing pieces come back named in `missing`. */
export function pumpingCost(p: {
  irrigationIn: number
  acres: number | null
  gpm: number | null
  hp: number | null
  powerCostKwh: number
}): { acreInches: number | null; hours: number | null; kwh: number | null; cost: number | null; perAc: number | null; perAcIn: number | null; missing: string[] } {
  const missing: string[] = []
  if (!p.acres) missing.push('irrigated acres')
  if (!p.gpm) missing.push('pivot flow (gpm)')
  if (!p.hp) missing.push('pump horsepower')
  const acreInches = p.acres ? p.irrigationIn * p.acres : null
  if (missing.length || acreInches == null) return { acreInches, hours: null, kwh: null, cost: null, perAc: null, perAcIn: null, missing }
  const hours = (acreInches * GAL_PER_ACRE_INCH) / (p.gpm! * 60)
  const kwh = pumpKwh(p.hp!, hours)
  const cost = kwh * p.powerCostKwh
  return { acreInches, hours, kwh, cost, perAc: cost / p.acres!, perAcIn: acreInches > 0 ? cost / acreInches : null, missing }
}

/**
 * A pivot's flow in US gpm: its own gpm, else its capacity in L/s, else what
 * FieldNET reports, else — when its pump feeds no other pivot — the pump's flow
 * (measured, or the pump-curve estimate). The last stands in for pivots whose
 * old, never-measured figure was cleared (#6 and #8, Sam, 6 Oct 2026).
 */
export function pivotFlow(
  pivot: { gpm: Num; system_capacity_ls: Num } | undefined,
  fieldnetFlow: number | null | undefined,
  soloPump?: { gpm: Num; gpm_estimate?: Num } | null,
): { gpm: number | null; from: string | null } {
  if (pos(pivot?.gpm)) return { gpm: pos(pivot?.gpm), from: 'pivot gpm' }
  if (pos(pivot?.system_capacity_ls)) return { gpm: pos(pivot?.system_capacity_ls)! / LS_PER_GPM, from: 'pivot capacity (L/s)' }
  if (fieldnetFlow) return { gpm: fieldnetFlow, from: 'FieldNET reported flow' }
  if (pos(soloPump?.gpm)) return { gpm: pos(soloPump?.gpm), from: 'pump gpm (its only pivot)' }
  if (pos(soloPump?.gpm_estimate)) return { gpm: pos(soloPump?.gpm_estimate), from: 'pump-curve estimate (its only pivot)' }
  return { gpm: null, from: null }
}

/**
 * The horsepower a pivot is charged. A pump feeding several pivots: this
 * pivot draws its share of the flow, so its share of the horsepower; with no
 * pump gpm to share it by, the full horsepower, said so.
 */
export function pivotHorsepower(
  pump: { name: string; horse_power: Num; gpm: Num } | undefined,
  pivotsOnPump: number,
  gpm: number | null,
): { hp: number | null; note: string | null } {
  let hp = pos(pump?.horse_power)
  let note: string | null = null
  const shared = pump ? pivotsOnPump > 1 : false
  if (hp && shared && gpm && pos(pump?.gpm) && gpm < pos(pump?.gpm)!) {
    hp = hp * (gpm / pos(pump?.gpm)!)
    note = `${pump!.name} feeds ${pivotsOnPump} pivots: this pivot is charged its share of the horsepower by flow`
  } else if (hp && shared) {
    note = `${pump!.name} feeds ${pivotsOnPump} pivots and has no gpm to share it by: the full horsepower is charged, so the cost is high`
  }
  return { hp, note }
}

/** kWh for a run of pumping hours at a horsepower: hp × 0.7457 ÷ 0.9 motor efficiency × hours. */
export function pumpKwh(hp: number, hours: number): number {
  return ((hp * KW_PER_HP) / MOTOR_EFFICIENCY) * hours
}

/** The balance rows the review reads for one field: actual days, whole field, else its first zone. */
export function pickBalance(rows: ReviewBalanceRow[]): ReviewBalanceRow[] {
  const actual = rows.filter((r) => !r.is_forecast)
  const whole = actual.filter((r) => r.zone_id == null)
  if (whole.length) return whole
  const zones = [...new Set(actual.map((r) => r.zone_id as string))].sort()
  return zones.length ? actual.filter((r) => r.zone_id === zones[0]) : []
}

export function balanceTotals(rows: ReviewBalanceRow[]) {
  let rain = 0
  let etc = 0
  let stress = 0
  let below = 0
  for (const r of rows) {
    rain += num(r.rainfall_mm) ?? 0
    etc += num(r.etc_mm) ?? 0
    if (r.status === 'now' || r.status === 'stress') stress++
    const ks = num(r.ks)
    const dr = num(r.dr_mm)
    const raw = num(r.raw_mm)
    if (ks != null ? ks < 1 : dr != null && raw != null && dr > raw) below++
  }
  return { days: rows.length, rainMm: rain, etcMm: etc, stressDays: stress, belowThresholdDays: below }
}

const SOURCE_LABEL: Record<string, string> = {
  scale: 'harvested, scale loads',
  jd_import: 'harvested, Deere yield',
  fah_import: 'harvested, Farm at Hand',
  rotation_xlsx: 'harvested, rotation sheet',
  manual: 'harvested, entered',
}

/** An efficiency typed as a percentage (85) is read as a fraction. */
const fraction = (v: Num): number | null => {
  const n = pos(v)
  if (n == null) return null
  return n > 1 ? n / 100 : n
}

export function buildWaterReview(d: ReviewData, powerCostKwh: number = DEFAULT_POWER_COST_KWH): WaterReviewRow[] {
  const cropById = new Map(d.crops.map((c) => [c.id, c]))
  const nameById = new Map(d.fields.map((f) => [f.id, f.name]))
  const pivotBy = new Map(d.pivots.map((p) => [p.field_id, p]))
  const pumpById = new Map(d.pumps.map((p) => [p.id, p]))
  const pivotsOnPump = new Map<string, number>()
  for (const p of d.pivots) if (p.pump_id) pivotsOnPump.set(p.pump_id, (pivotsOnPump.get(p.pump_id) ?? 0) + 1)
  const flowBy = new Map(d.fieldnetFlow.filter((f) => f.field_id).map((f) => [f.field_id as string, pos(f.flow)]))
  const group = <T extends { field_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) m.set(r.field_id, [...(m.get(r.field_id) ?? []), r])
    return m
  }
  const plansBy = group(d.plans)
  const histBy = group(d.history)
  const eventsBy = group(d.events)
  const balanceBy = group(d.balance)
  const seasonBy = group(d.seasons)

  // The fields: every one with a season this year. A year the water balance
  // never ran (before 2026) adds every pivot with a crop on it, so its yields
  // and logged passes still show.
  const fieldIds = [...new Set(d.seasons.map((s) => s.field_id))]
  if (!fieldIds.length || !d.balance.length) {
    for (const p of d.pivots) if (pos(p.acres_irrigated) && (plansBy.has(p.field_id) || histBy.has(p.field_id)) && !fieldIds.includes(p.field_id)) fieldIds.push(p.field_id)
  }

  const margin: MarginInputs = {
    crops: d.crops.map((c) => ({ id: c.id, name: c.name, yield_unit: c.yield_unit, default_yield_per_acre: num(c.default_yield_per_acre), margin_per_acre: num(c.margin_per_acre), own_use: Boolean(c.own_use) })),
    history: [],
    prices: d.prices,
    contracts: d.contracts,
    inputs: [],
    market: d.market,
    today: d.today,
  }

  const rows = fieldIds.map((fieldId): Omit<WaterReviewRow, 'relYield' | 'verdict'> => {
    const pivot = pivotBy.get(fieldId)
    const hist = [...(histBy.get(fieldId) ?? [])].sort((a, b) => (num(b.acres) ?? 0) - (num(a.acres) ?? 0))
    const plans = [...(plansBy.get(fieldId) ?? [])].sort((a, b) => (num(b.planned_acres) ?? 0) - (num(a.planned_acres) ?? 0))
    const cropId = hist[0]?.crop_id ?? plans[0]?.crop_id ?? null
    const crop = cropId ? cropById.get(cropId) : undefined
    const split = new Set([...hist, ...plans].map((r) => r.crop_id)).size > 1

    // Yield: harvested, else the plan's figure, else the crop's default.
    const h = hist.find((r) => r.crop_id === cropId && pos(r.yield_per_acre))
    const plan = plans.find((r) => r.crop_id === cropId)
    let yieldPer: number | null = null
    let yieldKind: YieldKind | null = null
    let yieldFrom = 'no yield'
    let yieldUnit = crop?.yield_unit ?? null
    if (h) {
      yieldPer = pos(h.yield_per_acre)
      yieldKind = 'actual'
      yieldFrom = SOURCE_LABEL[h.source] ?? `harvested, ${h.source}`
      yieldUnit = h.yield_unit ?? yieldUnit
    } else if (plan && pos(plan.yield_per_acre_override)) {
      yieldPer = pos(plan.yield_per_acre_override)
      yieldKind = 'estimate'
      yieldFrom = 'plan estimate'
    } else if (crop && pos(crop.default_yield_per_acre)) {
      yieldPer = pos(crop.default_yield_per_acre)
      yieldKind = 'estimate'
      yieldFrom = 'crop default'
    }
    // A record far from the crop's default (under a fifth, over five times)
    // was typed in another unit — alfalfa at "12 lbs" is 12 tons — so it is
    // shown but neither valued nor compared, as the rotation margins treat it.
    const dflt = pos(crop?.default_yield_per_acre)
    const wrongUnit = yieldPer != null && dflt != null && yieldUnit === crop?.yield_unit && (yieldPer < dflt * 0.2 || yieldPer > dflt * 5)
    if (wrongUnit) yieldFrom += ` — looks like the wrong unit (default ${dflt} ${yieldUnit})`

    // Water.
    const events = eventsBy.get(fieldId) ?? []
    const grossMm = events.reduce((s, e) => s + (num(e.gross_mm) ?? num(e.net_mm) ?? 0), 0)
    const season = seasonBy.get(fieldId)?.find((s) => s.zone_id == null) ?? seasonBy.get(fieldId)?.[0]
    const efficiency = fraction(pivot?.application_efficiency) ?? fraction(season?.application_efficiency) ?? DEFAULT_APPLICATION_EFFICIENCY
    const effectiveMm = grossMm * efficiency
    const bal = balanceTotals(pickBalance(balanceBy.get(fieldId) ?? []))
    const hasBal = bal.days > 0
    const irrigationIn = grossMm / MM_PER_IN
    const totalWaterIn = hasBal ? (effectiveMm + bal.rainMm) / MM_PER_IN : null

    // Pumping.
    const acres = pos(pivot?.acres_irrigated)
    const pump = pivot?.pump_id ? pumpById.get(pivot.pump_id) : undefined
    const { gpm, from: gpmFrom } = pivotFlow(pivot, flowBy.get(fieldId), pump && pivotsOnPump.get(pump.id) === 1 ? pump : null)
    const share = pivotHorsepower(pump, pump ? (pivotsOnPump.get(pump.id) ?? 0) : 0, gpm)
    const hp = share.hp
    let pumpNote = share.note
    const pc = pumpingCost({ irrigationIn, acres, gpm, hp, powerCostKwh })
    if (pc.missing.length) {
      const what = [...pc.missing]
      if (!pivot?.pump_id && what.includes('pump horsepower')) what[what.indexOf('pump horsepower')] = 'a pump linked to the pivot'
      pumpNote = `Missing ${what.join(', ')}`
    }

    // Value.
    let price: number | null = null
    let priceFrom = 'no price'
    if (cropId) {
      const m = cropMargin(margin, cropId, d.year, fieldId)
      if (wrongUnit) {
        priceFrom = 'yield looks like the wrong unit'
      } else if (m.price != null && yieldUnit != null && m.unit !== yieldUnit) {
        priceFrom = `price is per ${m.unit}, yield in ${yieldUnit}`
      } else {
        price = m.price
        priceFrom = m.priceFrom
      }
    }
    const grossPerAc = yieldPer != null && price != null ? yieldPer * price : null

    return {
      fieldId,
      fieldName: nameById.get(fieldId) ?? 'Unknown field',
      cropId,
      cropName: crop?.name ?? 'No crop',
      cropColor: crop?.color ?? null,
      split,
      acres,
      events: events.length,
      grossMm,
      efficiency,
      effectiveMm,
      balanceDays: bal.days,
      rainMm: hasBal ? bal.rainMm : null,
      etcMm: hasBal ? bal.etcMm : null,
      stressDays: hasBal ? bal.stressDays : null,
      belowThresholdDays: hasBal ? bal.belowThresholdDays : null,
      irrigationIn,
      totalWaterIn,
      yield: yieldPer,
      yieldUnit,
      yieldKind,
      yieldSuspect: wrongUnit,
      yieldFrom,
      yieldPerInTotal: yieldPer != null && totalWaterIn ? yieldPer / totalWaterIn : null,
      yieldPerInIrrigation: yieldPer != null && irrigationIn > 0 ? yieldPer / irrigationIn : null,
      gpm,
      gpmFrom,
      hp,
      acreInches: pc.acreInches,
      pumpHours: pc.hours,
      kwh: pc.kwh,
      pumpCost: pc.cost,
      pumpCostPerAc: pc.perAc,
      pumpCostPerAcIn: pc.perAcIn,
      pumpNote,
      price,
      priceFrom,
      grossPerAc,
      dollarsPerInIrrigation: grossPerAc != null && irrigationIn > 0 ? grossPerAc / irrigationIn : null,
    }
  })

  // Each crop's farm average, so corn and beans share one axis. Harvested
  // yields set it when there are any; estimates only when nothing is in.
  const avgYield = new Map<string, number>()
  const avgIrr = new Map<string, number>()
  const yieldCount = new Map<string, number>()
  for (const cropId of new Set(rows.map((r) => r.cropId).filter((c): c is string => c != null))) {
    const mine = rows.filter((r) => r.cropId === cropId && r.yield != null && !r.yieldSuspect)
    const actual = mine.filter((r) => r.yieldKind === 'actual')
    const basis = (actual.length ? actual : mine).filter((r) => r.yieldUnit === (actual[0] ?? mine[0])?.yieldUnit)
    const w = (r: (typeof rows)[number]) => r.acres ?? 1
    const totW = basis.reduce((s, r) => s + w(r), 0)
    if (totW > 0) avgYield.set(cropId, basis.reduce((s, r) => s + r.yield! * w(r), 0) / totW)
    yieldCount.set(cropId, basis.length)
    const watered = rows.filter((r) => r.cropId === cropId && r.irrigationIn > 0)
    const wW = watered.reduce((s, r) => s + w(r), 0)
    if (wW > 0) avgIrr.set(cropId, watered.reduce((s, r) => s + r.irrigationIn * w(r), 0) / wW)
  }

  return rows.map((r) => {
    const avg = r.cropId ? avgYield.get(r.cropId) : undefined
    const relYield = r.yield != null && !r.yieldSuspect && avg ? (r.yield / avg) * 100 : null
    const out = { ...r, relYield, verdict: '' }
    out.verdict = verdictFor(out, {
      cropAvgIrrigationIn: r.cropId ? (avgIrr.get(r.cropId) ?? null) : null,
      cropFieldsWithYield: r.cropId ? (yieldCount.get(r.cropId) ?? 0) : 0,
    })
    return out
  })
}

const pct = (v: number) => `${Math.round(v)}%`

/** One plain line on what the season's water says about this field. */
export function verdictFor(
  r: Pick<WaterReviewRow, 'cropName' | 'yield' | 'yieldKind' | 'relYield' | 'irrigationIn' | 'events' | 'balanceDays' | 'stressDays'> & { yieldSuspect?: boolean },
  ctx: { cropAvgIrrigationIn: number | null; cropFieldsWithYield: number },
): string {
  const crop = r.cropName.toLowerCase()
  const noWater = r.events === 0 && r.balanceDays === 0
  if (r.yield == null && noWater) return 'Nothing recorded for this season yet.'
  if (r.yieldSuspect) return 'The yield on record looks like the wrong unit — correct it on the field’s History before reading this field.'
  if (noWater) return 'A yield but no water record this year — nothing to judge the water by.'
  if (r.events === 0)
    return 'No irrigation logged: either it was not watered or its passes are missing (no FieldNET panel?) — the stress days assume it got none.'
  const stress = r.stressDays ?? 0
  const stressHigh = stress >= RULES.stressDaysHigh
  const ratio = ctx.cropAvgIrrigationIn && ctx.cropAvgIrrigationIn > 0 ? r.irrigationIn / ctx.cropAvgIrrigationIn : null
  const waterHigh = ratio != null && ratio >= RULES.waterHigh
  const waterLow = ratio != null && ratio <= RULES.waterLow
  if (r.yield == null) return stressHigh ? `No yield yet; ${stress} days at or past the irrigate trigger.` : 'No yield yet — water only.'
  if (r.yieldKind === 'estimate') {
    if (stressHigh) return `${stress} days at or past the irrigate trigger — check the yield when it comes in (yield shown is an estimate).`
    if (waterHigh) return `About ${pct((ratio! - 1) * 100)} more water than the other ${crop} fields; judge it when the yield is in.`
    return 'Not harvested yet (yield is an estimate); water looks ordinary.'
  }
  if (ctx.cropFieldsWithYield < 2 || r.relYield == null) {
    return stressHigh
      ? `The only harvested ${crop} field — ${stress} days at or past the trigger suggest water held it back.`
      : `The only harvested ${crop} field — nothing on the farm to compare it with.`
  }
  const rel = r.relYield
  if (stressHigh && rel < RULES.yieldLow) return `Likely water-limited: ${stress} days at or past the trigger and ${pct(rel)} of the ${crop} average.`
  if (waterHigh && rel <= RULES.yieldHigh) return `Water above what paid: ${pct((ratio! - 1) * 100)} more irrigation than the ${crop} average for ${pct(rel)} of its yield.`
  if (rel < RULES.yieldLow) return `Short yield (${pct(rel)} of the ${crop} average) and water was not the limit — look at stand, fertility or disease.`
  if (waterLow && rel >= 100) return `Made the most of its water: less irrigation than the ${crop} average, ${pct(rel)} of its yield.`
  if (rel >= RULES.yieldHigh) return `Top of the ${crop} fields (${pct(rel)}) on about average water.`
  return `In line with the other ${crop} fields.`
}

export type WaterReviewTotals = {
  fields: number
  acres: number
  /** Acre-weighted average depths, mm. */
  grossMm: number | null
  effectiveMm: number | null
  rainMm: number | null
  etcMm: number | null
  stressDays: number | null
  belowThresholdDays: number | null
  acreInches: number
  /** kWh behind the pumping total. */
  kwh: number | null
  pumpCost: number | null
  pumpCostPerAc: number | null
  pumpCostPerAcIn: number | null
  /** Fields the pumping total covers. */
  pumpFields: number
  grossValue: number | null
  grossPerAc: number | null
}

/** The table's totals row. Yields are left out: corn and beans don't add. */
export function reviewTotals(rows: WaterReviewRow[]): WaterReviewTotals {
  const acres = rows.reduce((s, r) => s + (r.acres ?? 0), 0)
  const wavg = (pick: (r: WaterReviewRow) => number | null) => {
    const has = rows.filter((r) => r.acres && pick(r) != null)
    const w = has.reduce((s, r) => s + r.acres!, 0)
    return w > 0 ? has.reduce((s, r) => s + pick(r)! * r.acres!, 0) / w : null
  }
  const costed = rows.filter((r) => r.pumpCost != null)
  const pumpCost = costed.length ? costed.reduce((s, r) => s + r.pumpCost!, 0) : null
  const costedAcres = costed.reduce((s, r) => s + (r.acres ?? 0), 0)
  const costedAcIn = costed.reduce((s, r) => s + (r.acreInches ?? 0), 0)
  const valued = rows.filter((r) => r.grossPerAc != null && r.acres)
  const grossValue = valued.length ? valued.reduce((s, r) => s + r.grossPerAc! * r.acres!, 0) : null
  const valuedAcres = valued.reduce((s, r) => s + r.acres!, 0)
  return {
    fields: rows.length,
    acres,
    grossMm: wavg((r) => r.grossMm),
    effectiveMm: wavg((r) => r.effectiveMm),
    rainMm: wavg((r) => r.rainMm),
    etcMm: wavg((r) => r.etcMm),
    stressDays: wavg((r) => r.stressDays),
    belowThresholdDays: wavg((r) => r.belowThresholdDays),
    acreInches: rows.reduce((s, r) => s + (r.acreInches ?? 0), 0),
    kwh: costed.length ? costed.reduce((s, r) => s + (r.kwh ?? 0), 0) : null,
    pumpCost,
    pumpCostPerAc: pumpCost != null && costedAcres > 0 ? pumpCost / costedAcres : null,
    pumpCostPerAcIn: pumpCost != null && costedAcIn > 0 ? pumpCost / costedAcIn : null,
    pumpFields: costed.length,
    grossValue,
    grossPerAc: grossValue != null && valuedAcres > 0 ? grossValue / valuedAcres : null,
  }
}
