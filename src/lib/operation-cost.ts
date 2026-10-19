/**
 * What one job on one field will cost — Sam, 16 Oct 2026: "select a field, a
 * type of field work like spraying or planting and put in the type of chemical
 * or any other input for that activity and it gives us an estimate of the cost
 * to do that thing based on all the costs including fuel, wages, input costs,
 * time in field etc."
 *
 * Nothing here carries a rate of its own. Every figure comes from what the app
 * already keeps, in this order of trust:
 *
 *   TIME     ac/h typed > speed × width × efficiency typed > that machine's own
 *            Deere passes of that kind > any machine's Deere passes of that kind
 *            > hand-entered field work records of that type.
 *   FUEL     L/h typed > that machine's logged fuel per working hour (Deere's
 *            per-point export) × hours > this farm's own L/ac for the kind of
 *            work (fuel.ts farmAverages) > the stated L/ac default (fuel.ts).
 *   LABOUR   hours × operators × the farm's wage (hauling-data useBasics).
 *   INPUTS   rate × acres × the price book's $/L or $/kg.
 *   TRAVEL   one round trip from the shop a day worked, at the road distance
 *            and the machine's road burn and speed (fuel.ts settings).
 *
 * Machinery ownership, repairs, land and overhead are not added: the budget
 * already charges them in the fixed $/ac, and adding them here would count
 * them twice. The screen shows that figure beside the total instead.
 *
 * Pure: the screen gathers the rows and passes them in.
 */
import { WORK_TYPES } from './field-work'
import { MIN_LOGGED_PASSES, kindOf, noPoints, opAcres, tripsFor, type FarmAverage, type FuelOp, type OpKind } from './fuel'

const AC_PER_HA = 2.4710538146716536
const M_PER_FT = 0.3048

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
const pos = (v: unknown): number | null => {
  const n = num(v)
  return n != null && n > 0 ? n : null
}

/* ------------------------------------------------------------ work types */

export type DeereKind = 'application' | 'seeding' | 'tillage' | 'harvest'

/** The Deere operation type a work type is logged as, or null when Deere never logs it. */
export function deereKindFor(workType: string): DeereKind | null {
  return WORK_TYPES.find((t) => t.key === workType)?.countsAs ?? null
}

/** The fuel model's kind for a work type: its Deere kind, else 'other'. */
export const fuelKindFor = (workType: string): OpKind => kindOf(deereKindFor(workType))

/* -------------------------------------------------------------- machines */

export type MachineIds = { jd_id: string | null; platform_machine_id: string | null; serial_number: string | null; vin?: string | null }

export type HistoryOp = FuelOp & {
  machine_id: string | null
  machine_vin: string | null
  work_minutes: number | string | null
}

/**
 * Whether a Deere pass was made by this machine. Deere's operation carries the
 * telematics id and the VIN; the fleet row keeps the telematics id as
 * platform_machine_id and the VIN as its serial number.
 */
export function opByMachine(op: Pick<HistoryOp, 'machine_id' | 'machine_vin'>, m: MachineIds): boolean {
  const id = op.machine_id?.trim()
  const vin = op.machine_vin?.trim().toUpperCase()
  if (id && (id === m.platform_machine_id || id === m.jd_id)) return true
  if (vin && (vin === m.serial_number?.trim().toUpperCase() || vin === m.vin?.trim().toUpperCase())) return true
  return false
}

/* --------------------------------------------------------------- history */

export type WorkHistory = {
  passes: number
  acres: number
  hours: number
  acPerHour: number | null
  /** Passes with fuel logged, and the litres and working hours on those passes only. */
  fuelPasses: number
  fuelL: number
  fuelHours: number
  lPerHour: number | null
  /** Days out on the job, and working hours over them. */
  days: number
  hoursPerDay: number | null
}

/**
 * The rate past Deere passes worked at: acres covered over the minutes the
 * machine was logging. A pass with no minutes, no acres, no points, or
 * somebody else's crop is left out.
 */
export function workHistory(ops: readonly HistoryOp[], fieldAcresOf: (op: HistoryOp) => number): WorkHistory | null {
  let passes = 0
  let acres = 0
  let hours = 0
  let fuelPasses = 0
  let fuelL = 0
  let fuelHours = 0
  let days = 0
  for (const op of ops) {
    if (op.not_ours || noPoints(op)) continue
    const h = (pos(op.work_minutes) ?? 0) / 60
    const ac = opAcres(op, fieldAcresOf(op))
    if (!(h > 0) || !(ac > 0)) continue
    passes++
    acres += ac
    hours += h
    days += Math.max(1, tripsFor(op))
    const l = pos(op.fuel_l)
    if (l != null) {
      fuelPasses++
      fuelL += l
      fuelHours += h
    }
  }
  if (!passes) return null
  return {
    passes,
    acres,
    hours,
    acPerHour: acres / hours,
    fuelPasses,
    fuelL,
    fuelHours,
    lPerHour: fuelHours > 0 ? fuelL / fuelHours : null,
    days,
    hoursPerDay: days > 0 ? hours / days : null,
  }
}

export type HandRecord = {
  work_type: string
  machine_ids: string[] | null
  hours: number | string | null
  acres: number | string | null
  started_at: string | null
  finished_at: string | null
}

/**
 * The rate hand-entered field work ran at: the records of this work type
 * (on this machine, when one is picked) with both hours and acres.
 */
export function handHistory(records: readonly HandRecord[], workType: string, machineId: string | null): WorkHistory | null {
  let passes = 0
  let acres = 0
  let hours = 0
  for (const r of records) {
    if (r.work_type !== workType) continue
    if (machineId && !(r.machine_ids ?? []).includes(machineId)) continue
    const typed = pos(r.hours)
    const span = r.started_at && r.finished_at ? (Date.parse(r.finished_at) - Date.parse(r.started_at)) / 3_600_000 : null
    const h = typed ?? (span != null && span > 0 ? span : null)
    const ac = pos(r.acres)
    if (h == null || ac == null) continue
    passes++
    acres += ac
    hours += h
  }
  if (!passes) return null
  return { passes, acres, hours, acPerHour: acres / hours, fuelPasses: 0, fuelL: 0, fuelHours: 0, lPerHour: null, days: 0, hoursPerDay: null }
}

/* ------------------------------------------------------------------ time */

/** Acres an hour from width (ft), speed (km/h) and the share of the hour working (%). */
export function acresPerHourFrom(widthFt: number, speedKmh: number, efficiencyPct: number | null): number | null {
  if (!(widthFt > 0) || !(speedKmh > 0)) return null
  const eff = efficiencyPct != null && efficiencyPct > 0 ? Math.min(efficiencyPct, 100) / 100 : 1
  return ((widthFt * M_PER_FT * speedKmh) / 10) * AC_PER_HA * eff
}

export type RateBasis = 'typed' | 'speed' | 'machine' | 'kind' | 'hand' | 'none'

export type RateChoice = { acPerHour: number | null; basis: RateBasis; note: string }

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 'es'}`

export function chooseWorkRate(o: {
  typedAcPerHour?: number | null
  widthFt?: number | null
  speedKmh?: number | null
  efficiencyPct?: number | null
  machine?: WorkHistory | null
  machineName?: string | null
  kind?: WorkHistory | null
  kindLabel?: string
  hand?: WorkHistory | null
}): RateChoice {
  const typed = pos(o.typedAcPerHour)
  if (typed != null) return { acPerHour: typed, basis: 'typed', note: 'typed' }
  const w = pos(o.widthFt)
  const s = pos(o.speedKmh)
  if (w != null && s != null) {
    const eff = pos(o.efficiencyPct)
    return {
      acPerHour: acresPerHourFrom(w, s, eff),
      basis: 'speed',
      note: `${w} ft × ${s} km/h${eff != null ? ` × ${eff}% working` : ', flat out (no turns or fills)'}`,
    }
  }
  if (o.machine?.acPerHour)
    return {
      acPerHour: o.machine.acPerHour,
      basis: 'machine',
      note: `${o.machineName ?? 'this machine'}'s own Deere passes: ${Math.round(o.machine.acres)} ac in ${o.machine.hours.toFixed(1)} h over ${plural(o.machine.passes, 'pass')}`,
    }
  if (o.kind?.acPerHour)
    return {
      acPerHour: o.kind.acPerHour,
      basis: 'kind',
      note: `every machine's Deere ${o.kindLabel ?? ''} passes: ${Math.round(o.kind.acres)} ac in ${o.kind.hours.toFixed(1)} h over ${plural(o.kind.passes, 'pass')}`.replace('  ', ' '),
    }
  if (o.hand?.acPerHour)
    return {
      acPerHour: o.hand.acPerHour,
      basis: 'hand',
      note: `field work records: ${Math.round(o.hand.acres)} ac in ${o.hand.hours.toFixed(1)} h over ${o.hand.passes} record${o.hand.passes === 1 ? '' : 's'}`,
    }
  return { acPerHour: null, basis: 'none', note: 'no Deere passes or records to go on — type a speed and width, or ac/h' }
}

/* ------------------------------------------------------------------ fuel */

export type FuelBasis = 'typed' | 'machine' | 'farm' | 'default'

export type FuelChoice = { litres: number; basis: FuelBasis; note: string }

export function chooseFuel(o: {
  acres: number
  hours: number | null
  typedLPerHour?: number | null
  machine?: WorkHistory | null
  machineName?: string | null
  farm?: FarmAverage | null
  defaultLPerAc: number
}): FuelChoice {
  const typed = pos(o.typedLPerHour)
  if (typed != null && o.hours != null) return { litres: typed * o.hours, basis: 'typed', note: `${typed} L/h typed × ${o.hours.toFixed(1)} h` }
  const m = o.machine
  if (m?.lPerHour != null && o.hours != null)
    return {
      litres: m.lPerHour * o.hours,
      basis: 'machine',
      note: `${o.machineName ?? 'this machine'} logged ${m.lPerHour.toFixed(1)} L a working hour (${m.fuelPasses} Deere pass${m.fuelPasses === 1 ? '' : 'es'}) × ${o.hours.toFixed(1)} h`,
    }
  const f = o.farm
  if (f && f.passes >= MIN_LOGGED_PASSES)
    return { litres: f.lPerAc * o.acres, basis: 'farm', note: `this farm's own ${f.lPerAc.toFixed(2)} L/ac (${f.passes} logged passes) × ${round1(o.acres)} ac` }
  return { litres: o.defaultLPerAc * o.acres, basis: 'default', note: `the fuel model's ${o.defaultLPerAc} L/ac default × ${round1(o.acres)} ac` }
}

const round1 = (v: number) => Math.round(v * 10) / 10

/* ---------------------------------------------------------------- inputs */

export type InputRow = {
  name: string
  /** What the price is per: 'L', 'kg', or whatever was typed (bu, bag, unit). */
  unit: string
  ratePerAc: number | null
  pricePerUnit: number | null
  priceSource: string
}

export type InputCost = InputRow & { quantity: number | null; cost: number | null }

export function inputCost(row: InputRow, acres: number): InputCost {
  const rate = num(row.ratePerAc)
  const quantity = rate != null && rate >= 0 ? rate * acres : null
  const price = num(row.pricePerUnit)
  return { ...row, quantity, cost: quantity != null && price != null ? quantity * price : null }
}

/** Rate units offered for a price-book product, as the factor into its canonical unit. */
export const RATE_UNITS: Record<'L' | 'kg', { key: string; label: string; toCanonical: number }[]> = {
  L: [
    { key: 'L', label: 'L/ac', toCanonical: 1 },
    { key: 'mL', label: 'mL/ac', toCanonical: 0.001 },
    { key: 'usgal', label: 'US gal/ac', toCanonical: 3.785411784 },
  ],
  kg: [
    { key: 'kg', label: 'kg/ac', toCanonical: 1 },
    { key: 'lb', label: 'lb/ac', toCanonical: 0.45359237 },
    { key: 'g', label: 'g/ac', toCanonical: 0.001 },
  ],
}

/* ---------------------------------------------------------------- travel */

export type TravelCost = { trips: number; km: number; litres: number; hours: number }

/** One round trip from the shop a day worked, each machine driving there. */
export function travelFor(o: { oneWayKm: number; days: number; machines: number; roadLPerKm: number; roadKmh: number }): TravelCost {
  const trips = Math.max(1, Math.ceil(o.days)) * Math.max(1, o.machines)
  const km = trips * 2 * o.oneWayKm
  return { trips, km, litres: km * o.roadLPerKm, hours: o.roadKmh > 0 ? km / o.roadKmh : 0 }
}

/* ----------------------------------------------------------------- total */

export type CostLine = {
  key: 'inputs' | 'fuel' | 'labour' | 'travel'
  label: string
  dollars: number | null
  note: string
}

export type OperationCost = {
  hours: number | null
  days: number | null
  litres: number
  lines: CostLine[]
  total: number
  perAcre: number | null
  /** Things that would change the total once filled in. */
  missing: string[]
}

export function operationCost(o: {
  acres: number
  rate: RateChoice
  /** Machines working at once; each needs an operator and makes its own trip. */
  machines: number
  hoursPerDay: number | null
  fuel: (hours: number | null) => FuelChoice
  dieselPerL: number
  dieselSource: string
  wage: number | null
  wageSource: string
  inputs: InputCost[]
  travel: { oneWayKm: number; roadLPerKm: number; roadKmh: number } | null
}): OperationCost {
  const machines = Math.max(1, Math.round(o.machines) || 1)
  const acres = Math.max(0, o.acres)
  // Each machine covers its share, so the job is done in a fraction of the hours,
  // but every machine-hour still burns fuel and pays an operator.
  const machineHours = o.rate.acPerHour ? acres / o.rate.acPerHour : null
  const hours = machineHours != null ? machineHours / machines : null
  const days = hours != null && o.hoursPerDay != null && o.hoursPerDay > 0 ? hours / o.hoursPerDay : null
  const missing: string[] = []

  const fuel = o.fuel(machineHours)
  const fuelDollars = fuel.litres * o.dieselPerL

  const priced = o.inputs.filter((i) => i.cost != null)
  const inputs = priced.reduce((s, i) => s + (i.cost ?? 0), 0)
  for (const i of o.inputs) {
    if (i.quantity == null) missing.push(`a rate for ${i.name}`)
    else if (i.cost == null) missing.push(`a price for ${i.name}`)
  }

  let travel: TravelCost | null = null
  if (o.travel && o.travel.oneWayKm > 0) travel = travelFor({ ...o.travel, days: days ?? 1, machines })

  const labourHours = machineHours != null ? machineHours + (travel?.hours ?? 0) : null
  const labour = labourHours != null && o.wage != null ? labourHours * o.wage : null
  if (machineHours == null) missing.push('a work rate (ac/h)')
  if (o.wage == null) missing.push('a wage rate')
  if (machineHours != null && o.hoursPerDay == null) missing.push('hours a day, for days')

  const lines: CostLine[] = [
    {
      key: 'inputs',
      label: 'Inputs',
      dollars: o.inputs.length ? inputs : null,
      note: o.inputs.length ? `${priced.length} of ${o.inputs.length} priced` : 'none added',
    },
    {
      key: 'fuel',
      label: 'Fuel — in the field',
      dollars: fuelDollars,
      note: `${Math.round(fuel.litres).toLocaleString('en-CA')} L: ${fuel.note}; at $${o.dieselPerL.toFixed(3)}/L (${o.dieselSource})`,
    },
    {
      key: 'labour',
      label: 'Labour',
      dollars: labour,
      note:
        labourHours == null
          ? 'needs a work rate'
          : o.wage == null
            ? 'set a wage rate'
            : `${labourHours.toFixed(1)} operator-hours${travel ? ' (incl. the road)' : ''} × $${o.wage.toFixed(2)}/h (${o.wageSource})`,
    },
  ]
  if (travel) {
    const road = travel.litres * o.dieselPerL
    lines.push({
      key: 'travel',
      label: 'Fuel — to the field and back',
      dollars: road,
      note: `${travel.trips} round trip${travel.trips === 1 ? '' : 's'} of ${round1(o.travel!.oneWayKm * 2)} km, ${Math.round(travel.km)} km at ${o.travel!.roadLPerKm} L/km`,
    })
  }

  const total = lines.reduce((s, l) => s + (l.dollars ?? 0), 0)
  const litres = fuel.litres + (travel?.litres ?? 0)
  return { hours, days, litres, lines, total, perAcre: acres > 0 ? total / acres : null, missing }
}
