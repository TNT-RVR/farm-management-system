/**
 * Fuel for each pass: in the field, and driving to it and back.
 *
 * IN THE FIELD. Deere's per-point export logs the fuel burned between points
 * (the FUEL column), so a pass whose export has been read carries what the
 * machine actually burned while working it — `fuel_l`. It counts only logged
 * points: the booms-on, implement-in-the-ground time. Turning on the
 * headland with everything off, waiting on a fill, and the road are not in
 * it, which is why the road is added separately below.
 *
 * A pass with no logged fuel (not read yet, or an older display that did not
 * log it) is estimated as litres an acre × the acres it covered. The litres an
 * acre is this farm's own average for that kind of work where enough passes
 * have been read, otherwise a stated default — never a hidden number.
 *
 * THE ROAD. One round trip from the shop to the field's entry and back per
 * day worked on the field, at the road (and trail) distance (road-routes.ts),
 * at the machine's road burn and speed. A pass Deere logged no points for was
 * never driven to, and costs nothing.
 */
import { passAcres, type AppliedOp } from './applied'
import type { OpSession } from './op-sessions'
import type { Trip } from './road-routes'
import { farmTz } from './farm-context'

export type OpKind = 'application' | 'seeding' | 'tillage' | 'harvest' | 'other'

export const OP_KINDS: { key: OpKind; label: string; machine: string }[] = [
  { key: 'application', label: 'Spraying', machine: 'self-propelled sprayer' },
  { key: 'seeding', label: 'Seeding / planting', machine: 'tractor and drill or planter' },
  { key: 'tillage', label: 'Tillage', machine: 'tractor and cultivator' },
  { key: 'harvest', label: 'Harvest', machine: 'combine' },
  { key: 'other', label: 'Anything else', machine: 'tractor' },
]

export const kindOf = (type: string | null | undefined): OpKind =>
  type === 'application' || type === 'seeding' || type === 'tillage' || type === 'harvest' ? type : 'other'

export type FuelSettings = {
  dieselPerL: number
  /** In-field litres an acre when a pass logged none and the farm has no average of its own. */
  lPerAc: Record<OpKind, number>
  /** Litres a km on the road, by the machine that does the work. */
  roadLPerKm: Record<OpKind, number>
  /** Road speed, km/h. */
  roadKmh: Record<OpKind, number>
}

/**
 * The stated defaults.
 *
 * In-field litres an acre: Iowa State Extension PM 709, "Fuel Required for
 * Field Operations" (diesel, gal/ac × 3.785): field cultivator 0.70 gal,
 * air seeder / planter 0.40, self-propelled sprayer 0.10, combine in corn
 * 1.75. This farm's own logged passes replace them as soon as there are
 * enough. Road burn and speed are round numbers for a machine travelling
 * light — Sam's to correct.
 */
export const FUEL_DEFAULTS: Omit<FuelSettings, 'dieselPerL'> = {
  lPerAc: { application: 0.4, seeding: 1.5, tillage: 2.6, harvest: 6.6, other: 2 },
  roadLPerKm: { application: 0.35, seeding: 0.6, tillage: 0.7, harvest: 0.6, other: 0.5 },
  roadKmh: { application: 40, seeding: 30, tillage: 25, harvest: 25, other: 30 },
}

/** Fewer read passes than this and the farm average is not trusted over the default. */
export const MIN_LOGGED_PASSES = 3

export const L_PER_US_GAL = 3.785411784

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export type FuelOp = AppliedOp & {
  id: string
  operation_type: string | null
  fuel_l?: number | string | null
  fuel_read_at?: string | null
  field_id?: string | null
  crop_season?: number | null
}

/** The acres a pass covered: Deere's covered area for a spray, the field otherwise. */
export function opAcres(op: FuelOp, fieldAcres: number): number {
  if (op.operation_type === 'application') return passAcres(op, fieldAcres).acres
  if (op.not_ours) return 0
  const override = num(op.cost_acres_override)
  return override ?? fieldAcres
}

/** True when Deere logged no points for the pass at all: nothing happened. */
export const noPoints = (op: Pick<FuelOp, 'sessions'>) => Array.isArray(op.sessions) && op.sessions.length === 0

/**
 * The days the machine went out to this field for this pass. A sitting of
 * under a minute is the display switched on in the yard, not a trip.
 */
export function tripsFor(op: Pick<FuelOp, 'sessions' | 'started_at'>): number {
  const sessions = Array.isArray(op.sessions) ? (op.sessions as OpSession[]) : []
  const days = sessions.filter((s) => (s.minutes ?? 0) >= 1 && s.start).map((s) => localDay(s.start))
  if (days.length) return new Set(days).size
  return op.started_at ? 1 : 0
}

/** The farm's calendar day, not UTC's: an evening pass in Alberta is tomorrow in UTC. */
function localDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: farmTz() })
}

export type FarmAverage = { lPerAc: number; passes: number; acres: number }

/**
 * Litres an acre this farm's own machines logged, by kind of work. Only passes
 * with fuel AND acres count; a 0 from an export with no points is not a pass.
 */
export function farmAverages(ops: FuelOp[], acresOf: (op: FuelOp) => number): Partial<Record<OpKind, FarmAverage>> {
  const acc = new Map<OpKind, { l: number; ac: number; n: number }>()
  for (const o of ops) {
    const l = num(o.fuel_l)
    if (l == null || l <= 0 || noPoints(o)) continue
    const ac = acresOf(o)
    if (!(ac > 0)) continue
    const k = kindOf(o.operation_type)
    const a = acc.get(k) ?? { l: 0, ac: 0, n: 0 }
    a.l += l
    a.ac += ac
    a.n++
    acc.set(k, a)
  }
  const out: Partial<Record<OpKind, FarmAverage>> = {}
  for (const [k, a] of acc) out[k] = { lPerAc: a.l / a.ac, passes: a.n, acres: a.ac }
  return out
}

export type OpFuel = {
  kind: OpKind
  acres: number
  inField: {
    litres: number
    basis: 'logged' | 'farm' | 'default' | 'none'
    /** Plain words for where the litres came from. */
    note: string
  }
  travel: {
    litres: number
    trips: number
    /** Round-trip km over every trip. */
    km: number
    hours: number
    /** Where the one-way distance came from, when it is not the road router's. */
    note: string | null
  } | null
  litres: number
  dollars: number
}

/** One pass's fuel, both halves, in litres and dollars. */
export function opFuel(
  op: FuelOp,
  args: {
    fieldAcres: number
    /** Shop → the field's entry, one way. Null when the field has no location. */
    trip: Trip | null
    settings: FuelSettings
    farm: Partial<Record<OpKind, FarmAverage>>
  },
): OpFuel {
  const kind = kindOf(op.operation_type)
  const acres = opAcres(op, args.fieldAcres)
  const s = args.settings
  if (noPoints(op) || op.not_ours) {
    return {
      kind,
      acres,
      inField: { litres: 0, basis: 'none', note: op.not_ours ? 'not our cost' : 'Deere logged no points — never run' },
      travel: null,
      litres: 0,
      dollars: 0,
    }
  }

  const logged = num(op.fuel_l)
  let inField: OpFuel['inField']
  if (logged != null && logged > 0) {
    inField = { litres: logged, basis: 'logged', note: 'logged by the machine while working' }
  } else {
    const avg = args.farm[kind]
    const useFarm = avg && avg.passes >= MIN_LOGGED_PASSES
    const rate = useFarm ? avg.lPerAc : s.lPerAc[kind]
    inField = {
      litres: rate * acres,
      basis: useFarm ? 'farm' : 'default',
      note: useFarm
        ? `estimated at this farm's own ${rate.toFixed(1)} L/ac (${avg.passes} logged ${kind === 'other' ? '' : OP_KINDS.find((k) => k.key === kind)!.label.toLowerCase() + ' '}passes)`
        : `estimated at the default ${rate.toFixed(1)} L/ac`,
    }
  }

  let travel: OpFuel['travel'] = null
  if (args.trip) {
    const trips = tripsFor(op)
    const km = trips * 2 * args.trip.km
    travel = {
      trips,
      km,
      litres: km * s.roadLPerKm[kind],
      hours: s.roadKmh[kind] > 0 ? km / s.roadKmh[kind] : 0,
      note: args.trip.note,
    }
  }
  const litres = inField.litres + (travel?.litres ?? 0)
  return { kind, acres, inField, travel, litres, dollars: litres * s.dieselPerL }
}

/** Every pass on a field added up: in field, on the road, and the dollars. */
export function sumFuel(rows: OpFuel[]) {
  let inField = 0
  let travel = 0
  let travelKm = 0
  let travelHours = 0
  let logged = 0
  for (const r of rows) {
    inField += r.inField.litres
    if (r.inField.basis === 'logged') logged += r.inField.litres
    travel += r.travel?.litres ?? 0
    travelKm += r.travel?.km ?? 0
    travelHours += r.travel?.hours ?? 0
  }
  return { inField, travel, travelKm, travelHours, litres: inField + travel, logged }
}
