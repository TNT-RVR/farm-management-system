/**
 * What it costs to truck a field's crop where it is going.
 *
 * Each field-year has a haul plan: straight to an elevator, into our bin yard
 * and no further, into the bin yard and out to an elevator later, or into the
 * bin yard for a buyer who collects it (seed canola — the company's trucks,
 * the company's cost). The crop's weight ÷ the truck's payload is the number
 * of loads; each load is a round trip at the road distance, plus time to fill
 * and to dump. Fuel is the km at the truck's burn; labour is the hours at the
 * wage.
 *
 * Every number that is a guess is a setting with its default stated beside it.
 */
import { convertMass, type MassUnit } from './bushels'
import type { Trip } from './road-routes'

export type HaulMode = 'direct' | 'bin_yard' | 'bin_yard_then_elevator' | 'buyer_pickup'

export const HAUL_MODES: { key: HaulMode; label: string; hint: string; needsSite: boolean }[] = [
  { key: 'direct', label: 'Straight to the elevator', hint: 'field → elevator', needsSite: true },
  { key: 'bin_yard', label: 'Bin yard only', hint: 'field → our bins, and it stays (feed, carry-over)', needsSite: false },
  { key: 'bin_yard_then_elevator', label: 'Bin yard, then the elevator', hint: 'field → our bins now, bins → elevator later', needsSite: true },
  { key: 'buyer_pickup', label: 'Buyer picks up at the yard', hint: 'field → our bins; the buyer trucks it from there at their cost', needsSite: false },
]

export type TruckSettings = {
  /** Tonnes a load. */
  payloadT: number
  /** Litres a km, loaded one way and empty back, averaged. */
  lPerKm: number
  /** Minutes at each end: filling, and dumping (scale and pit at an elevator). */
  loadMin: number
  unloadMin: number
  /** A loaded truck is slower than the router's car. 1.15 = 15% slower. */
  timeFactor: number
}

/**
 * Defaults. Payload is the app's existing Super B figure (42 t; the ten loads
 * weighed in so far averaged 44 t). The burn is a loaded Super B averaged with
 * the empty trip back (about 0.55 L/km). The minutes are round numbers.
 */
export const TRUCK_DEFAULTS: { field: TruckSettings; highway: TruckSettings } = {
  field: { payloadT: 42, lPerKm: 0.55, loadMin: 20, unloadMin: 15, timeFactor: 1.15 },
  highway: { payloadT: 42, lPerKm: 0.55, loadMin: 15, unloadMin: 20, timeFactor: 1.15 },
}

/** When only a straight-line distance is known, the truck's speed. */
const FALLBACK_KMH = 60

/** The crop's yield unit as the bushel converter names it. */
export function massUnit(unit: string | null | undefined): MassUnit | null {
  const u = (unit ?? '').toLowerCase().trim()
  if (u === 'bu' || u === 'bushel' || u === 'bushels') return 'bu'
  if (u === 'lb' || u === 'lbs' || u === 'pounds') return 'lb'
  if (u === 'cwt') return 'cwt'
  if (u === 'mt' || u === 't' || u === 'tonne' || u === 'tonnes') return 't'
  if (u === 'kg') return 'kg'
  if (u === 'ton' || u === 'tons' || u === 'ston') return 'ston'
  return null
}

/** A quantity of crop, in tonnes. Null when the unit cannot be weighed (bushels with no bushel weight). */
export function tonnesOf(qty: number, unit: string | null | undefined, lbPerBu: number | null): number | null {
  const m = massUnit(unit)
  if (!m) return null
  return convertMass(qty, m, 't', lbPerBu)
}

export type HaulLeg = {
  label: string
  /** One way. */
  oneWayKm: number
  loads: number
  /** Round trips, all loads. */
  km: number
  hours: number
  litres: number
  fuel: number
  labour: number
  total: number
  note: string | null
}

export type HaulCost = {
  tonnes: number
  legs: HaulLeg[]
  litres: number
  hours: number
  fuel: number
  labour: number
  total: number
  perTonne: number | null
  /** What is missing for a full answer, when something is. */
  missing: string | null
}

function leg(label: string, tonnes: number, trip: Trip, truck: TruckSettings, dieselPerL: number, wage: number): HaulLeg {
  const loads = truck.payloadT > 0 ? Math.ceil(tonnes / truck.payloadT) : 0
  const km = loads * 2 * trip.km
  const driveMin = trip.minutes != null ? trip.minutes * truck.timeFactor : (trip.km / FALLBACK_KMH) * 60
  const hours = (loads * (2 * driveMin + truck.loadMin + truck.unloadMin)) / 60
  const litres = km * truck.lPerKm
  const fuel = litres * dieselPerL
  const labour = hours * wage
  return { label, oneWayKm: trip.km, loads, km, hours, litres, fuel, labour, total: fuel + labour, note: trip.note }
}

/**
 * The trucking for one field's crop.
 *
 * `trips` are one way: field entry → the bins, field entry → the chosen
 * elevator, the bins → the chosen elevator. A leg the plan needs but has no
 * distance for is reported in `missing` and left out, never costed at zero km
 * silently.
 */
export function haulCost(args: {
  tonnes: number
  mode: HaulMode
  trips: { fieldYard: Trip | null; fieldSite: Trip | null; yardSite: Trip | null }
  siteName: string | null
  truck: { field: TruckSettings; highway: TruckSettings }
  dieselPerL: number
  wage: number
}): HaulCost {
  const { tonnes, mode, trips, truck, dieselPerL, wage } = args
  const site = args.siteName ?? 'the elevator'
  const legs: HaulLeg[] = []
  const missing: string[] = []
  const add = (label: string, trip: Trip | null, t: TruckSettings, what: string) => {
    if (trip) legs.push(leg(label, tonnes, trip, t, dieselPerL, wage))
    else missing.push(what)
  }
  const needsSite = HAUL_MODES.find((m) => m.key === mode)?.needsSite
  if (needsSite && !args.siteName) missing.push('which elevator')
  if (mode === 'direct' && args.siteName) add(`Field → ${site}`, trips.fieldSite, truck.field, `a distance from the field to ${site}`)
  if (mode === 'bin_yard' || mode === 'buyer_pickup' || mode === 'bin_yard_then_elevator')
    add('Field → bin yard', trips.fieldYard, truck.field, 'a distance from the bins to the field')
  if (mode === 'bin_yard_then_elevator' && args.siteName) add(`Bin yard → ${site}`, trips.yardSite, truck.highway, `a distance from the bins to ${site}`)

  const sum = (k: 'litres' | 'hours' | 'fuel' | 'labour' | 'total') => legs.reduce((s, l) => s + l[k], 0)
  const total = sum('total')
  return {
    tonnes,
    legs,
    litres: sum('litres'),
    hours: sum('hours'),
    fuel: sum('fuel'),
    labour: sum('labour'),
    total,
    perTonne: tonnes > 0 && legs.length ? total / tonnes : null,
    missing: missing.length ? `Needs ${missing.join(' and ')}` : null,
  }
}
