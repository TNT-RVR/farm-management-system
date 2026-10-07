/**
 * Manure hauling: what the custom hauler charged, and what doing it ourselves
 * would cost, on the same road distances.
 *
 * CUSTOM. N & K Custom bill Tridrive hours (a truck that hauls and spreads),
 * so the cost of a field is hours × rate, and the hours depend on the haul:
 * each load is a fixed stretch of loading and spreading plus the drive out
 * and back. Two invoice lines at two distances are enough to separate the
 * two — a straight line through (round-trip km, hours a load) — and that
 * line prices any other field. From invoice #1160: #1 at 6.9 km took 0.47 h
 * a load, 8/Ray Daltons at 2.2 km took 0.28 h, which is about 11 minutes
 * a load in the field and the road at about 49 km/h.
 *
 * OURSELVES. One of our tractors pulling a spreader, a loader filling it,
 * two people and our diesel. The width and speed are the farm's; the
 * tractor's burn is what Deere logged for it; the spreader's size and the
 * machine costs (ownership and repairs an hour) are not known yet and are
 * placeholders, marked as such.
 */
import type { Trip } from './road-routes'

export type InvoiceLine = {
  hours: number | null
  rate: number | null
  amount: number
  loads: number | null
  tonnes: number | null
  /** One-way km from the shop to the entry of the field it was hauled to. */
  oneWayKm: number | null
}

export type CustomModel = {
  /** Hours a load spent loading and spreading, whatever the distance. */
  fixedHours: number
  /** Hours a load for each round-trip km. */
  hoursPerKm: number
  /** $/h billed. */
  rate: number
  /** Tonnes a load. */
  tonnesPerLoad: number
  /** How many invoice lines the fit stands on. */
  lines: number
  /** True when the two parts came from the invoices; false when one was assumed. */
  fitted: boolean
}

/** Road speed assumed when there is only one invoice line to fit. */
const ASSUMED_KMH = 50

/** The custom hauler's cost model, fitted to their invoice lines. */
export function fitCustomModel(lines: InvoiceLine[]): CustomModel | null {
  const pts = lines
    .filter((l) => l.hours != null && l.hours > 0 && l.loads != null && l.loads > 0 && l.oneWayKm != null)
    .map((l) => ({ x: 2 * l.oneWayKm!, y: l.hours! / l.loads!, l }))
  if (!pts.length) return null
  const hours = pts.reduce((s, p) => s + p.l.hours!, 0)
  const rate = pts.reduce((s, p) => s + (p.l.rate ?? p.l.amount / p.l.hours!) * p.l.hours!, 0) / hours
  const loads = pts.reduce((s, p) => s + p.l.loads!, 0)
  const tonnes = pts.reduce((s, p) => s + (p.l.tonnes ?? 0), 0)
  const tonnesPerLoad = tonnes > 0 ? tonnes / loads : 16
  // Least squares through (round-trip km, hours a load). A slope that comes
  // out negative or absurd (two lines at almost the same distance) is not
  // believed; the road is then assumed at ASSUMED_KMH.
  const n = pts.length
  const mx = pts.reduce((s, p) => s + p.x, 0) / n
  const my = pts.reduce((s, p) => s + p.y, 0) / n
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  const sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0)
  let slope = sxx > 1 ? sxy / sxx : NaN
  let fitted = true
  if (!(slope > 1 / 120 && slope < 1 / 15)) {
    slope = 1 / ASSUMED_KMH
    fitted = false
  }
  const fixed = Math.max(0, my - slope * mx)
  return { fixedHours: fixed, hoursPerKm: slope, rate, tonnesPerLoad, lines: n, fitted }
}

/** What the custom hauler would charge for so many tonnes at this distance. */
export function customCost(model: CustomModel, tonnes: number, trip: Trip) {
  const loads = Math.ceil(tonnes / model.tonnesPerLoad)
  const hours = loads * (model.fixedHours + model.hoursPerKm * 2 * trip.km)
  const total = hours * model.rate
  return { loads, hours, total, perTonne: tonnes > 0 ? total / tonnes : 0 }
}

export type OwnManureSettings = {
  /** Tonnes a load in our own spreader. */
  tonnesPerLoad: number
  /** Spread width, feet. */
  widthFt: number
  /** Spreading speed, mph. */
  speedMph: number
  /** Share of the spreading time actually spreading (turns, overlaps), 0–1. */
  efficiency: number
  /** Minutes a load besides loading and spreading: hooking up, waiting at the loader, getting into the field. */
  turnMin: number
  /** Tractor and loaded spreader on the road, km/h. */
  roadKmh: number
  /** The tractor's diesel, litres an hour working. The default gives way to Deere's own figure when there is one. */
  tractorLph: number
  /** The loader's diesel, litres an hour. */
  loaderLph: number
  /** Minutes the loader works a load (the spreader waits for it). */
  loaderMinPerLoad: number
  /** Ownership + repairs, $/h. Placeholders until the farm prices its own. */
  tractorMachinePerHour: number
  loaderMachinePerHour: number
}

/**
 * The tractors that would pull our spreader. Sam, 5 Oct 2026: "We would
 * use the JD 8100 or the 8R 250 tractor for spreading."
 */
export const OWN_MANURE_TRACTORS: { label: string; match: RegExp }[] = [
  { label: '8R 250', match: /8R[ -]?250/i },
  { label: '8100', match: /(^|[^0-9R])8100([^0-9]|$)/i },
]

/**
 * Defaults. Width and speed are Sam's (60 ft, 8 mph, "varies based on need
 * in that area"). The spreader's size is not known yet, so a load is N & K's
 * own average until it is; the repair and ownership figures are placeholders
 * too. The tractor's burn comes from what Deere logged for the tractors
 * above (tractorFuel), and this figure only when Deere has none.
 */
export const OWN_MANURE_DEFAULTS: OwnManureSettings = {
  tonnesPerLoad: 16.2,
  widthFt: 60,
  speedMph: 8,
  efficiency: 0.7,
  turnMin: 4,
  roadKmh: 35,
  tractorLph: 30,
  loaderLph: 18,
  loaderMinPerLoad: 4,
  tractorMachinePerHour: 60,
  loaderMachinePerHour: 40,
}

/** Acres an hour spreading: width (ft) × speed (mph) ÷ 8.25, times the share of the time actually spreading. */
export function spreadAcresPerHour(s: Pick<OwnManureSettings, 'widthFt' | 'speedMph' | 'efficiency'>): number {
  return ((s.widthFt * s.speedMph) / 8.25) * Math.max(0, Math.min(1, s.efficiency))
}

/**
 * Doing it ourselves, at this distance and rate: a tractor and spreader
 * cycling between the pile and the field, a loader filling it.
 *
 *   a load = loader minutes + spreading (its tonnes ÷ t/ac ÷ ac/h)
 *            + turn minutes + the drive out and back
 */
export function ownCost(s: OwnManureSettings, tonnes: number, trip: Trip, dieselPerL: number, wage: number, tonsPerAcre: number) {
  const loads = s.tonnesPerLoad > 0 ? Math.ceil(tonnes / s.tonnesPerLoad) : 0
  const acPerHour = spreadAcresPerHour(s)
  const spreadMin = tonsPerAcre > 0 && acPerHour > 0 ? (s.tonnesPerLoad / tonsPerAcre / acPerHour) * 60 : 0
  const loadHours = (s.loaderMinPerLoad + spreadMin + s.turnMin) / 60 + (s.roadKmh > 0 ? (2 * trip.km) / s.roadKmh : 0)
  const tractorHours = loads * loadHours
  const loaderHours = (loads * s.loaderMinPerLoad) / 60
  const litres = tractorHours * s.tractorLph + loaderHours * s.loaderLph
  const fuel = litres * dieselPerL
  // The loader operator is there the whole time the tractor is cycling.
  const labour = 2 * tractorHours * wage
  const machine = tractorHours * s.tractorMachinePerHour + loaderHours * s.loaderMachinePerHour
  const total = fuel + labour + machine
  return { loads, spreadMin, tractorHours, loaderHours, km: loads * 2 * trip.km, litres, fuel, labour, machine, total, perTonne: tonnes > 0 ? total / tonnes : 0 }
}

/** A pass as the tractor-fuel figure reads it: what Deere logged, and the machine on it. */
export type TractorPass = {
  operation_type: string | null
  fuel_l: number | string | null
  work_minutes: number | string | null
  machines: { name?: string | null }[] | null
}

export type TractorFuel = {
  /** Litres an hour over every pass the tractors logged fuel and working time on. */
  lph: number
  litres: number
  hours: number
  passes: number
  /** The tractors found, by their Deere name. */
  tractors: string[]
  /** L/h by kind of pass, most hours first. */
  byKind: { kind: string; lph: number; hours: number; passes: number }[]
}

/** Deere's "fieldOperationType" as words: "tillage", "seeding", "harvest". */
const kindOf = (t: string | null) =>
  (t ?? 'other')
    .split(/(?=[A-Z])/)
    .join(' ')
    .toLowerCase()

/**
 * The tractors' own burn from Operations Center: the litres Deere logged ÷
 * the hours it logged them working, over every pass by one of the named
 * tractors. Manure has never been spread with them, so this is their burn
 * across the work they have done; the split by kind of pass shows how far
 * apart the jobs are. Null when Deere has nothing for them.
 */
export function tractorFuel(rows: TractorPass[], tractors = OWN_MANURE_TRACTORS): TractorFuel | null {
  const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0)
  const kinds = new Map<string, { litres: number; minutes: number; passes: number }>()
  const names = new Set<string>()
  let litres = 0
  let minutes = 0
  let passes = 0
  for (const r of rows) {
    const name = (r.machines ?? []).map((m) => m?.name ?? '').find((x) => tractors.some((t) => t.match.test(x)))
    const l = n(r.fuel_l)
    const m = n(r.work_minutes)
    if (!name || !(l > 0) || !(m > 0)) continue
    names.add(name)
    litres += l
    minutes += m
    passes++
    const kind = kindOf(r.operation_type)
    const k = kinds.get(kind) ?? { litres: 0, minutes: 0, passes: 0 }
    k.litres += l
    k.minutes += m
    k.passes++
    kinds.set(kind, k)
  }
  if (!(minutes > 0)) return null
  return {
    lph: litres / (minutes / 60),
    litres,
    hours: minutes / 60,
    passes,
    tractors: [...names].sort(),
    byKind: [...kinds.entries()]
      .map(([kind, k]) => ({ kind, lph: k.litres / (k.minutes / 60), hours: k.minutes / 60, passes: k.passes }))
      .sort((a, b) => b.hours - a.hours),
  }
}
