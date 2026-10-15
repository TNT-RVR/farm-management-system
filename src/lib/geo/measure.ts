import type { Position } from 'geojson'
import { M2_PER_ACRE, ringAreaM2 } from './area'

/**
 * Measuring off the map: how far, and how much.
 *
 * Kept away from the map component because it is arithmetic, and arithmetic
 * about acres is worth a test. The map's job is collecting the points.
 *
 * UNITS ARE A CHOICE, not a house style. The same farm measures a pivot run in
 * feet, a field in acres, a haul in kilometres and a seed rep's plot in
 * hectares — and a tool that answers in one of those is a tool somebody has to
 * convert out of on a phone calculator.
 */

const EARTH_RADIUS_M = 6371008.8

/** Great-circle metres between two [lng, lat] points. */
export function haversineM(a: Position, b: Position): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Metres along a path. Zero for fewer than two points. */
export function pathLengthM(points: Position[]): number {
  let m = 0
  for (let i = 1; i < points.length; i++) m += haversineM(points[i - 1], points[i])
  return m
}

/**
 * Square metres enclosed by a path, closing it back to the first point.
 *
 * The line is measured as drawn and the area as if the last point joined the
 * first, which is how somebody walking the outside of a piece expects it to
 * read — nobody clicks the starting corner twice.
 */
export function pathAreaM2(points: Position[]): number {
  if (points.length < 3) return 0
  const first = points[0]
  const last = points[points.length - 1]
  // Closed only if it is not closed already. Repeating the first corner a
  // second time is not harmless: the area is computed about the mean latitude
  // of the ring, so an extra copy of one corner drags that mean and moves the
  // answer — eleven square metres on a quarter section, but moved by nothing
  // more than how the caller happened to pass the points.
  const closed = first[0] === last[0] && first[1] === last[1]
  return Math.abs(ringAreaM2(closed ? points : [...points, first]))
}

export type DistanceUnit = 'm' | 'km' | 'ft' | 'yd' | 'mi'
export type AreaUnit = 'ac' | 'ha' | 'm2' | 'ft2' | 'mi2'

/** Metres in one of each. */
export const DISTANCE_UNITS: { key: DistanceUnit; label: string; short: string; per: number }[] = [
  { key: 'm', label: 'metres', short: 'm', per: 1 },
  { key: 'km', label: 'kilometres', short: 'km', per: 1000 },
  { key: 'ft', label: 'feet', short: 'ft', per: 0.3048 },
  { key: 'yd', label: 'yards', short: 'yd', per: 0.9144 },
  { key: 'mi', label: 'miles', short: 'mi', per: 1609.344 },
]

/** Square metres in one of each. */
export const AREA_UNITS: { key: AreaUnit; label: string; short: string; per: number }[] = [
  { key: 'ac', label: 'acres', short: 'ac', per: M2_PER_ACRE },
  { key: 'ha', label: 'hectares', short: 'ha', per: 10_000 },
  { key: 'm2', label: 'square metres', short: 'm²', per: 1 },
  { key: 'ft2', label: 'square feet', short: 'ft²', per: 0.3048 * 0.3048 },
  { key: 'mi2', label: 'square miles', short: 'mi²', per: 1609.344 * 1609.344 },
]

export const toDistance = (metres: number, unit: DistanceUnit): number =>
  metres / (DISTANCE_UNITS.find((u) => u.key === unit)?.per ?? 1)

export const toArea = (m2: number, unit: AreaUnit): number =>
  m2 / (AREA_UNITS.find((u) => u.key === unit)?.per ?? 1)

/**
 * A number somebody can read out.
 *
 * Decimals by size rather than a fixed number of them: "1,320 ft" and "0.41 mi"
 * are the same measurement, and both are useless written the other way round —
 * 1,320.00 ft is noise and 0 mi is wrong.
 */
export function formatNumber(v: number): string {
  const abs = Math.abs(v)
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : 3
  return v.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function formatDistance(metres: number, unit: DistanceUnit): string {
  const u = DISTANCE_UNITS.find((x) => x.key === unit) ?? DISTANCE_UNITS[0]
  return `${formatNumber(toDistance(metres, unit))} ${u.short}`
}

export function formatArea(m2: number, unit: AreaUnit): string {
  const u = AREA_UNITS.find((x) => x.key === unit) ?? AREA_UNITS[0]
  return `${formatNumber(toArea(m2, unit))} ${u.short}`
}
