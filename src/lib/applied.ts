import { mergeMixEntries, type OpComponent, type OpProduct, type OpRate, type OpRaw } from './fieldOps'
import { farmTz } from './farm-context'

// Turning Deere's per-acre rates into "what actually went on this field".
//
// UNITS: Deere writes `gal1ac-1` without saying whose gallon. Proven US from the
// data itself — a sampled pass records a total of 20 gal/ac against a carrier of
// 19.712 gal/ac plus components of 0.9 L/ac and 189 mL/ac. Those balance to
// 0.001 L/ac under US gallons and are out by 0.22 under Imperial. Guessing wrong
// here would be a silent 20% error in every cost figure.
const L_PER_US_GAL = 3.785411784
const KG_PER_LB = 0.45359237
const KG_PER_OZ = 0.028349523125

export type Canonical = 'L' | 'kg'

/** Deere unit id to a canonical per-acre amount. Null when unrecognised. */
export function toCanonicalRate(
  value: number | undefined,
  unitId: string | undefined,
): { rate: number; unit: Canonical } | null {
  if (value == null || !unitId) return null
  switch (unitId) {
    case 'gal1ac-1':
      return { rate: value * L_PER_US_GAL, unit: 'L' }
    case 'l1ac-1':
      return { rate: value, unit: 'L' }
    case 'ml1ac-1':
      return { rate: value / 1000, unit: 'L' }
    case 'lb1ac-1':
      return { rate: value * KG_PER_LB, unit: 'kg' }
    case 'kg1ac-1':
      return { rate: value, unit: 'kg' }
    case 'g1ac-1':
      return { rate: value / 1000, unit: 'kg' }
    case 'oz1ac-1':
      return { rate: value * KG_PER_OZ, unit: 'kg' }
    default:
      // Null rather than a guess: an unrecognised unit surfaces as "unknown" in
      // the UI instead of quietly contributing a wrong number to a total.
      return null
  }
}

/**
 * One pass that put one product on the field.
 *
 * Kept alongside the aggregate because the aggregate answers "how much" and
 * this answers "when, by whom, and at what rate" — which is the question asked
 * of a spray record months later. The raw Deere rate is carried unconverted
 * next to the canonical one: a record that says "0.356 L/ac" when the operator
 * set 20 gal/ac of solution is a record nobody can check against the ticket.
 */
export type AppliedEvent = {
  /** Stable per row: the Deere operation id plus which product on it. */
  key: string
  startedAt: string | null
  endedAt: string | null
  /** The spelling this pass used, before the price book folded it. */
  typedAs: string
  /** The tank mix this component came out of, when it came out of one. */
  mixName: string | null
  tankMix: boolean
  /** As Deere recorded it, unconverted. */
  rawRate: OpRate | null
  /** Canonical per-acre rate, or null when the unit was not recognised. */
  rate: number | null
  unit: Canonical | null
  /** rate x the pass's acres, or null when there was no usable rate. */
  total: number | null
  cost: number | null
  /** The acres this pass is costed on, and where that number came from. */
  acres: number
  acresBasis: AcresBasis
  /** Local dates the sprayer was out on this pass. */
  visitDays: string[]
  carrierName: string | null
  carrierRate: OpRate | null
  machine: string | null
  operator: string | null
  crop: string | null
  jdId: string | null
  /** Conditions during the pass, where Deere recorded them. */
  windKmh: number | null
  gustKmh: number | null
  windDirDeg: number | null
  tempC: number | null
  humidityPct: number | null
  speedKmh: number | null
  /** Where the weather came from — modelled at the field, or off the machine. */
  conditionsSource: 'deere' | 'ecmwf' | 'none' | null
  /** The instant the weather describes. Differs from the pass midpoint when
      Deere rolled several days of spraying into one operation. */
  weatherAt: string | null
}

/** One product's as-applied figures, as stored by the sync. */
export type AsAppliedRow = {
  name?: string
  /** Deere's product id — the same guid as the planned component's. */
  productId?: string
  carrier?: boolean
  totalValue?: number | null
  totalUnit?: string | null
  rateValue?: number | null
  rateUnit?: string | null
}

/** A total already applied, in whatever unit Deere reported it. */
export type MeasuredTotal = { value: number; unitId: string }

/**
 * A MEASURED total to canonical L or kg.
 *
 * Distinct from `toCanonicalRate`, which handles per-acre units. These are
 * absolute quantities off the machine — 10,854 ml, 2,294.6 l — and converting
 * one with the rate table would silently treat a total as a rate.
 */
export function toCanonicalTotal(
  value: number | undefined,
  unitId: string | undefined,
): { qty: number; unit: Canonical } | null {
  if (value == null || !Number.isFinite(value) || !unitId) return null
  switch (unitId.toLowerCase()) {
    case 'l':
      return { qty: value, unit: 'L' }
    case 'ml':
      return { qty: value / 1000, unit: 'L' }
    case 'gal':
    case 'gal1':
      return { qty: value * L_PER_US_GAL, unit: 'L' }
    case 'kg':
      return { qty: value, unit: 'kg' }
    case 'g':
      return { qty: value / 1000, unit: 'kg' }
    case 'lb':
      return { qty: value * KG_PER_LB, unit: 'kg' }
    case 'oz':
      return { qty: value * KG_PER_OZ, unit: 'kg' }
    default:
      return null
  }
}

const ACRES_PER_HA = 2.4710538146716536
export const haToAcres = (ha: number) => ha * ACRES_PER_HA

export type AppliedLine = {
  product: string
  unit: Canonical
  total: number
  passes: number
  /** Rates we could not convert, so the UI can say so instead of under-reporting. */
  unknownUnits: string[]
  /** Null when the product carries no price yet — never zero, which reads as free. */
  cost: number | null
  /** Every raw Deere spelling that fed this line, for "why is this grouped?". */
  aliases: string[]
  /** The individual passes, newest first — what the row expands into. */
  events: AppliedEvent[]
  /**
   * What the machine actually put out, summed across the passes that reported
   * it. Null when no pass did — never zero, which would read as "none applied".
   */
  measuredTotal: number | null
  measuredCost: number | null
  /** Passes whose as-applied figures are missing, so the measured total is short. */
  measuredMissing: number
}

/** Resolves a name typed into Deere to the product actually bought. */
export type ProductResolver = (deereName: string) => {
  name: string
  pricePerUnit: number | null
} | null

/**
 * What went on a field, by product, across the given operations.
 *
 * Uses each mix's COMPONENTS rather than the mix name — the components are the
 * products actually bought and applied; the mix name is only a label. The
 * carrier (water) is kept out of product totals and reported on its own.
 *
 * `resolve` folds Deere's hand-typed spellings together, so "Roundup" and
 * "RoundUp" become one line at one price instead of two.
 */
/**
 * As much of a Deere operation as the breakdown needs. Structurally a subset of
 * the `jd_field_operations` row, so callers pass the row itself.
 */
export type AppliedOp = {
  products: unknown
  jd_id?: string | null
  started_at?: string | null
  ended_at?: string | null
  operator_name?: string | null
  treated_crop?: string | null
  raw?: unknown
  // Postgres numerics come back as strings through PostgREST often enough that
  // typing these as numbers would be a lie the UI pays for.
  applied_area_ha?: number | string | null
  as_applied?: unknown
  wind_speed_kmh?: number | string | null
  wind_gust_kmh?: number | string | null
  wind_dir_deg?: number | null
  air_temp_c?: number | string | null
  humidity_pct?: number | string | null
  app_speed_kmh?: number | string | null
  conditions_source?: 'deere' | 'ecmwf' | 'none' | null
  weather_at?: string | null
  sessions?: unknown
  cost_acres_override?: number | string | null
  /** 'custom_work' | 'rented_out' — somebody else's crop; not our cost. */
  not_ours?: string | null
}

/** Everything about a pass that a single product's event needs to carry. */
type EventContext = {
  index: number
  acres: number
  acresBasis: AcresBasis
  visitDays: string[]
  jdId: string | null
  startedAt: string | null
  endedAt: string | null
  mixName: string | null
  tankMix: boolean
  carrierName: string | null
  carrierRate: OpRate | null
  machine: string | null
  operator: string | null
  crop: string | null
  windKmh: number | null
  gustKmh: number | null
  windDirDeg: number | null
  tempC: number | null
  humidityPct: number | null
  speedKmh: number | null
  conditionsSource: 'deere' | 'ecmwf' | 'none' | null
  weatherAt: string | null
}

/** Postgres numerics arrive as strings through PostgREST often enough to matter. */
const num = (v: number | string | null | undefined): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * A measured "product" that is really the whole spray solution.
 *
 * When a chemical is set up in the display as a single product rather than
 * as a tank mix with water, the sprayer logs everything that went through
 * the boom as that chemical: Armory on Whitfield SE (Sep 2026) at 224 L/ha,
 * 5,963 L. No chemical is sprayed at 20 L an acre; above that (about
 * 49 L/ha) the figure is the tank, not the product, and is left out.
 */
export const WHOLE_TANK_L_HA = 49

export function looksLikeWholeTank(m: AsAppliedRow, products: unknown): boolean {
  if (m.carrier || m.rateValue == null) return false
  if (!/^l1ha-1$/i.test(m.rateUnit ?? '') || Number(m.rateValue) <= WHOLE_TANK_L_HA) return false
  const list = (Array.isArray(products) ? products : []) as (OpProduct & { guid?: string; productType?: string })[]
  const entry = list.find((p) => p.guid === m.productId || (p.name ?? '').trim().toLowerCase() === (m.name ?? '').trim().toLowerCase())
  // A component of a proper tank mix is measured on its own; only a
  // single-product chemical pass can have swallowed the water.
  return !!entry && !entry.tankMix && (entry.productType ?? 'CHEMICAL').toUpperCase() === 'CHEMICAL'
}

/** Where a pass's acres came from, for the "why this many acres" note. */
export type AcresBasis = 'override' | 'covered' | 'capped' | 'measured' | 'field' | 'not_ours'

export const ACRES_BASIS_LABEL: Record<AcresBasis, string> = {
  override: 'acres set by hand',
  covered: 'acres Deere logged as covered',
  capped: "Deere logged more than the field; capped at the field's acres per visit",
  measured: 'no area logged; worked back from the product the sprayer measured',
  field: "no area or product logged; costed on the field's acres",
  not_ours: "not our cost — the renter's crop or a rented-out field; kept for the record",
}

const VISIT_GAP_DAYS = 3
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: farmTz() })
const dayGap = (a: string, b: string) => Math.abs(Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000

/** Distinct visits in a list of days: a gap of more than three days starts a new one. */
export function countVisits(days: string[]): number {
  const sorted = [...new Set(days)].sort()
  let n = 0
  let last: string | null = null
  for (const d of sorted) {
    if (last == null || dayGap(last, d) > VISIT_GAP_DAYS) n++
    last = d
  }
  return n
}

/**
 * The days a pass was out, from the sittings read off Deere's per-point
 * export; the start date when those have not been read.
 */
export function passVisitDays(op: Pick<AppliedOp, 'sessions' | 'started_at'>): string[] {
  const sessions = Array.isArray(op.sessions) ? (op.sessions as { start?: string }[]) : []
  const days = sessions.map((x) => (x.start ? dayOf(x.start) : null)).filter((d): d is string => d != null)
  if (days.length) return [...new Set(days)].sort()
  return op.started_at ? [dayOf(op.started_at)] : []
}

/**
 * The acres a pass is costed on.
 *
 * Deere's covered area where it logged one — that is what the sprayer
 * actually went over — but never more than the field's acres per visit: a
 * record whose area is five times the field (a Deere field drawn bigger than
 * ours) cannot put five fields' worth of cost on this one. With no area, the
 * product the machine measured putting out, divided by the planned rate,
 * says how much ground it covered; a test run that put out 3 L of Roundup
 * is 5 acres, not the whole field. With neither, the field's acres.
 */
export function passAcres(op: AppliedOp, fieldAcres: number): { acres: number; basis: AcresBasis } {
  if (op.not_ours) return { acres: 0, basis: 'not_ours' }
  const override = num(op.cost_acres_override)
  if (override != null) return { acres: override, basis: 'override' }
  const areaHa = num(op.applied_area_ha)
  if (areaHa != null && areaHa > 0) {
    const covered = haToAcres(areaHa)
    const visits = Math.max(1, countVisits(passVisitDays(op)))
    const cap = fieldAcres * visits
    if (fieldAcres > 0 && covered > cap * 1.05) return { acres: cap, basis: 'capped' }
    return { acres: covered, basis: 'covered' }
  }
  const measured = Array.isArray(op.as_applied) ? (op.as_applied as AsAppliedRow[]) : []
  const planned = new Map<string, OpRate | undefined>()
  for (const p of (Array.isArray(op.products) ? op.products : []) as OpProduct[]) {
    for (const c of p.components ?? []) if (c.guid) planned.set(c.guid, c.rate)
    if (p.carrier?.guid) planned.set(p.carrier.guid, p.carrier.rate)
  }
  const worked: number[] = []
  for (const m of measured) {
    if (!m.productId || !(Number(m.totalValue ?? 0) > 0)) continue
    const rate = planned.get(m.productId)
    const r = toCanonicalRate(rate?.value, rate?.unitId)
    const t = toCanonicalTotal(m.totalValue ?? undefined, m.totalUnit ?? undefined)
    if (r && t && r.unit === t.unit && r.rate > 0) worked.push(t.qty / r.rate)
  }
  if (worked.length) {
    worked.sort((a, b) => a - b)
    const mid = worked[Math.floor(worked.length / 2)]
    return { acres: fieldAcres > 0 ? Math.min(mid, fieldAcres) : mid, basis: 'measured' }
  }
  return { acres: fieldAcres, basis: 'field' }
}

export function appliedByProduct(
  ops: AppliedOp[],
  acres: number,
  resolve?: ProductResolver,
): {
  lines: AppliedLine[]
  waterL: number
  costed: number
  uncosted: number
  measuredCosted: number
  measuredUncosted: number
  appliedAcres: number | null
  passesWithArea: number
  passesWithMaterialNoArea: number
  passesWithoutMeasured: number
  measuredOrphans: string[]
} {
  const byProduct = new Map<string, AppliedLine>()
  const prices = new Map<string, number | null>()
  let waterL = 0
  let appliedAcresTotal = 0
  let passesWithArea = 0
  let passesWithMaterialNoArea = 0
  const measuredOrphans: string[] = []
  const opsWithoutMeasured = new Set<string>()

  const add = (rawName: string, c: OpComponent, ctx: EventContext) => {
    const conv = toCanonicalRate(c.rate?.value, c.rate?.unitId)
    const typed = rawName.trim() || 'unnamed product'
    const resolved = resolve?.(typed)
    const key = resolved?.name ?? typed
    if (!prices.has(key)) prices.set(key, resolved?.pricePerUnit ?? null)
    const line =
      byProduct.get(key) ??
      ({
        product: key,
        unit: conv?.unit ?? 'L',
        total: 0,
        passes: 0,
        unknownUnits: [],
        cost: null,
        aliases: [],
        events: [],
        measuredTotal: null,
        measuredCost: null,
        measuredMissing: 0,
      } as AppliedLine)
    if (!line.aliases.includes(typed)) line.aliases.push(typed)
    line.events.push({
      key: `${ctx.jdId ?? 'op'}:${ctx.index}:${typed}`,
      startedAt: ctx.startedAt,
      endedAt: ctx.endedAt,
      typedAs: typed,
      mixName: ctx.mixName,
      tankMix: ctx.tankMix,
      rawRate: c.rate ?? null,
      rate: conv?.rate ?? null,
      unit: conv?.unit ?? null,
      total: conv ? conv.rate * ctx.acres : null,
      // Filled once the price is known, below — a per-event cost needs the same
      // "unconvertible means uncosted" rule the line total gets.
      cost: null,
      carrierName: ctx.carrierName,
      carrierRate: ctx.carrierRate,
      machine: ctx.machine,
      operator: ctx.operator,
      crop: ctx.crop,
      jdId: ctx.jdId,
      windKmh: ctx.windKmh,
      gustKmh: ctx.gustKmh,
      windDirDeg: ctx.windDirDeg,
      tempC: ctx.tempC,
      humidityPct: ctx.humidityPct,
      speedKmh: ctx.speedKmh,
      conditionsSource: ctx.conditionsSource,
      weatherAt: ctx.weatherAt,
      acres: ctx.acres,
      acresBasis: ctx.acresBasis,
      visitDays: ctx.visitDays,
    })
    if (!conv) {
      // Flag whatever went wrong — an unrecognised unit, or no rate recorded at
      // all. Both leave the total understated, and an unflagged 0 L reads as
      // "nothing was applied" when the truth is "Deere didn't say".
      const reason = c.rate?.unitId ?? 'no rate recorded'
      if (!line.unknownUnits.includes(reason)) line.unknownUnits.push(reason)
    } else if (conv.unit === line.unit) {
      line.total += conv.rate * ctx.acres
    } else if (!line.unknownUnits.includes(conv.unit)) {
      // Same product recorded once by volume and once by mass — never add those.
      line.unknownUnits.push(conv.unit)
    }
    byProduct.set(key, line)
  }

  for (const op of ops) {
    if (!Array.isArray(op.products)) continue
    // The same mix listed twice in one record is one job, not two.
    const products = mergeMixEntries(op.products as OpProduct[])
    // Machine and operator come off `raw` where it is present: the flat columns
    // keep only the first of each, and a two-machine pass should not lose one.
    const raw = (op.raw ?? {}) as OpRaw
    const machines = raw.fieldOperationMachines ?? []
    const machine = machines.map((m) => m.name).filter(Boolean).join(', ') || null
    const operator =
      machines
        .flatMap((m) => (m.operators ?? []).map((o) => o.name))
        .filter(Boolean)
        .join(', ') ||
      op.operator_name ||
      null
    let index = 0
    const pass = passAcres(op, acres)
    const visitDays = passVisitDays(op)
    for (const p of products) {
      if (p.carrier) {
        const conv = toCanonicalRate(p.carrier.rate?.value, p.carrier.rate?.unitId)
        if (conv?.unit === 'L') waterL += conv.rate * pass.acres
      }
      const ctx: EventContext = {
        index: index++,
        acres: pass.acres,
        acresBasis: pass.basis,
        visitDays,
        jdId: op.jd_id ?? raw.id ?? null,
        startedAt: op.started_at ?? raw.startDate ?? null,
        endedAt: op.ended_at ?? raw.endDate ?? null,
        mixName: p.name ?? null,
        tankMix: Boolean(p.tankMix),
        carrierName: p.carrier?.name ?? null,
        carrierRate: p.carrier?.rate ?? null,
        machine,
        operator,
        crop: op.treated_crop ?? raw.treatedCropName ?? raw.cropName ?? null,
        windKmh: num(op.wind_speed_kmh),
        gustKmh: num(op.wind_gust_kmh),
        windDirDeg: num(op.wind_dir_deg),
        tempC: num(op.air_temp_c),
        humidityPct: num(op.humidity_pct),
        speedKmh: num(op.app_speed_kmh),
        conditionsSource: op.conditions_source ?? null,
        weatherAt: op.weather_at ?? null,
      }
      const components = p.components ?? []
      if (components.length > 0) {
        for (const c of components) add(c.name ?? 'component', c, ctx)
      } else if (p.name) {
        // A single-product pass carries no components; the product is the rate.
        // Its own name is the mix name too, so drop the redundant label.
        add(p.name, { name: p.name, rate: p.rate }, { ...ctx, mixName: null })
      }
    }

    // ── What the machine actually put out ────────────────────────────────
    //
    // Folded onto the same lines through the same resolver, because Deere uses
    // the same product names in both places (checked against a real pass:
    // "Delaro® Complete" and "excel 70" appear in the plan and in the totals).
    const measured = Array.isArray(op.as_applied) ? (op.as_applied as AsAppliedRow[]) : null
    const areaHa = num(op.applied_area_ha)
    // A pass can report 0.00 ha and still carry material — one really does.
    // Its material is genuine and its coverage is unknown, so it counts toward
    // the cost and NOT toward the coverage, and the caller is told.
    const covered = areaHa != null && areaHa > 0
    // When the pass is costed on fewer acres than it logged (capped at the
    // field, or set by hand), only that share of what it put out is this
    // field's. The rest went on ground outside our boundary.
    const measuredShare =
      pass.basis === 'not_ours'
        ? 0
        : covered && (pass.basis === 'capped' || pass.basis === 'override')
          ? Math.min(1, pass.acres / haToAcres(areaHa!))
          : 1
    if (covered) {
      appliedAcresTotal += haToAcres(areaHa!)
      passesWithArea += 1
    }
    if (measured) {
      if (!covered && measured.some((m) => !m.carrier && (m.totalValue ?? 0) > 0)) {
        passesWithMaterialNoArea += 1
      }
      for (const m of measured) {
        // The carrier is water. It has no product cost and is reported on its
        // own, exactly as the target side does.
        if (m.carrier || !m.name) continue
        const conv = toCanonicalTotal(m.totalValue ?? undefined, m.totalUnit ?? undefined)
        if (looksLikeWholeTank(m, op.products)) {
          const l = byProduct.get(resolve?.(m.name.trim())?.name ?? m.name.trim())
          if (l) {
            l.measuredMissing += 1
            if (!l.unknownUnits.includes('logged as the whole spray solution')) l.unknownUnits.push('logged as the whole spray solution')
          }
          continue
        }
        const typed = m.name.trim()
        const key = resolve?.(typed)?.name ?? typed
        const line = byProduct.get(key)
        // A product measured but never planned still belongs on the tally, or
        // the measured total would silently exclude it.
        if (!line) {
          measuredOrphans.push(typed)
          continue
        }
        // A product planned with no rate (a single-product fertilizer pass
        // carries none) was given 'L' by default, which is a guess, not a
        // unit. The measured total is the only real unit it has, so it takes
        // that one — otherwise 2,464 kg of urea read as "not litres" and was
        // thrown away, and the pass showed as unpriced.
        if (conv && line.measuredTotal == null && line.events.every((e) => e.unit == null)) {
          line.unit = conv.unit
        }
        if (!conv || conv.unit !== line.unit) {
          line.measuredMissing += 1
          continue
        }
        line.measuredTotal = (line.measuredTotal ?? 0) + conv.qty * measuredShare
      }
    } else {
      opsWithoutMeasured.add(op.jd_id ?? String(opsWithoutMeasured.size))
    }
  }

  let costed = 0
  let uncosted = 0
  let measuredCosted = 0
  let measuredUncosted = 0
  for (const line of byProduct.values()) {
    const price = prices.get(line.product) ?? null
    // A line with an unconvertible rate has an understated total, so pricing it
    // would understate the cost too. Left uncosted rather than quietly low.
    if (price != null && line.unknownUnits.length === 0) {
      line.cost = line.total * price
      costed += line.cost
      for (const e of line.events) e.cost = e.total == null ? null : e.total * price
    } else {
      uncosted += 1
    }
    // The measured total is priced on its own terms: it can be complete even
    // where the target total is not, and vice versa.
    if (price != null && line.measuredTotal != null && line.measuredMissing === 0) {
      line.measuredCost = line.measuredTotal * price
      measuredCosted += line.measuredCost
    } else if (line.measuredTotal != null) {
      measuredUncosted += 1
    }
    // Newest pass first, matching how the work history reads.
    line.events.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
    // A pass is a work order, not a Deere record: half a field on Monday and
    // the other half on Tuesday is one pass; Deere rolling two sprays twelve
    // days apart into one record is two.
    line.passes = countVisits(line.events.flatMap((e) => e.visitDays)) + line.events.filter((e) => !e.visitDays.length).length
  }

  return {
    lines: [...byProduct.values()].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || b.total - a.total),
    waterL,
    costed,
    uncosted,
    /** Cost of what the machine measured itself putting out. */
    measuredCosted,
    measuredUncosted,
    /**
     * Ground actually covered, summed over the passes that reported it. Null
     * when none did — 0 would read as "nothing was covered", a different and
     * much worse claim.
     *
     * NOT a cost denominator. Several passes over one field sum past the
     * field's own acres, and dividing a season's cost by that would understate
     * it. Divide by the FIELD's acres for a figure comparable to a budget, and
     * use this against `passesWithArea` for average coverage per pass.
     */
    appliedAcres: appliedAcresTotal > 0 ? appliedAcresTotal : null,
    passesWithArea,
    /** Passes carrying material but reporting no coverage — cost known, area not. */
    passesWithMaterialNoArea,
    /** Passes with no as-applied figures, so the measured side is short. */
    passesWithoutMeasured: opsWithoutMeasured.size,
    /** Measured products that are not on the plan at all. */
    measuredOrphans: [...new Set(measuredOrphans)],
  }
}

export const fmtQty = (v: number, unit: Canonical) =>
  `${v.toLocaleString('en-CA', { maximumFractionDigits: v < 10 ? 2 : 0 })} ${unit}`

export const fmtMoney = (v: number) =>
  v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })
