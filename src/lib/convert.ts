// Unit conversion for water and land.
//
// Every factor below is an exact definition, not a rounded figure, so chained
// conversions don't drift. The two that cause real mistakes on a farm:
//
//   • US vs Imperial gallons. An Imperial gallon is 20% larger. Canadian water
//     licences and older equipment often mean Imperial; most sprayer and pump
//     literature means US. They are listed separately and never abbreviated to
//     just "gal" anywhere in the UI.
//   • dam³ (cubic decametre, 1000 m³) is the unit Alberta water licences are
//     written in, and is easily misread as "decametres cubed".

export type Family = 'volume' | 'area' | 'flow' | 'depth' | 'weight' | 'distance'

export type Unit = {
  key: string
  label: string
  /** Multiply by this to get the family's base unit. */
  factor: number
  family: Family
  /** Sensible number of decimals when displaying this unit. */
  digits?: number
}

// --- exact definitions -------------------------------------------------------
const M2_PER_ACRE = 4046.8564224 // international acre, exact
const L_PER_M3 = 1000
const M3_PER_ACRE_FT = 43560 * 0.028316846592 // 43,560 ft³ · exact ft³→m³
const L_PER_ACRE_FT = M3_PER_ACRE_FT * L_PER_M3
const L_PER_US_GAL = 3.785411784 // exact
const L_PER_IMP_GAL = 4.54609 // exact

/** Volumes, base = litre. */
export const VOLUME: Unit[] = [
  { key: 'ml', label: 'millilitres (mL)', factor: 0.001, family: 'volume', digits: 0 },
  { key: 'l', label: 'litres (L)', factor: 1, family: 'volume', digits: 1 },
  { key: 'm3', label: 'cubic metres (m³)', factor: L_PER_M3, family: 'volume', digits: 2 },
  { key: 'dam3', label: 'cubic decametres (dam³)', factor: L_PER_M3 * 1000, family: 'volume', digits: 3 },
  { key: 'usgal', label: 'US gallons', factor: L_PER_US_GAL, family: 'volume', digits: 1 },
  { key: 'impgal', label: 'Imperial gallons', factor: L_PER_IMP_GAL, family: 'volume', digits: 1 },
  { key: 'acrein', label: 'acre-inches', factor: L_PER_ACRE_FT / 12, family: 'volume', digits: 3 },
  { key: 'acreft', label: 'acre-feet', factor: L_PER_ACRE_FT, family: 'volume', digits: 3 },
]

/** Areas, base = square metre. */
export const AREA: Unit[] = [
  { key: 'm2', label: 'square metres (m²)', factor: 1, family: 'area', digits: 0 },
  { key: 'ac', label: 'acres', factor: M2_PER_ACRE, family: 'area', digits: 2 },
  { key: 'ha', label: 'hectares', factor: 10_000, family: 'area', digits: 2 },
  { key: 'km2', label: 'square kilometres (km²)', factor: 1_000_000, family: 'area', digits: 4 },
  { key: 'quarter', label: 'quarter sections (160 ac)', factor: M2_PER_ACRE * 160, family: 'area', digits: 3 },
  { key: 'section', label: 'sections (640 ac)', factor: M2_PER_ACRE * 640, family: 'area', digits: 4 },
]

/** Flow rates, base = litres per second. */
export const FLOW: Unit[] = [
  { key: 'ls', label: 'litres/second (L/s)', factor: 1, family: 'flow', digits: 2 },
  { key: 'm3h', label: 'cubic metres/hour (m³/h)', factor: L_PER_M3 / 3600, family: 'flow', digits: 2 },
  { key: 'usgpm', label: 'US gallons/minute (GPM)', factor: L_PER_US_GAL / 60, family: 'flow', digits: 1 },
  { key: 'impgpm', label: 'Imperial gallons/minute', factor: L_PER_IMP_GAL / 60, family: 'flow', digits: 1 },
  { key: 'cfs', label: 'cubic feet/second (cfs)', factor: 28.316846592, family: 'flow', digits: 3 },
]

/** Depths of applied water, base = millimetre. */
export const DEPTH: Unit[] = [
  { key: 'mm', label: 'millimetres (mm)', factor: 1, family: 'depth', digits: 1 },
  { key: 'cm', label: 'centimetres (cm)', factor: 10, family: 'depth', digits: 2 },
  { key: 'in', label: 'inches', factor: 25.4, family: 'depth', digits: 2 },
  { key: 'ft', label: 'feet', factor: 304.8, family: 'depth', digits: 3 },
]

/**
 * Weights, base = kilogram.
 *
 * Both tons are here and both are labelled, because "ton" on its own is
 * ambiguous by 10% and that is the size of error that gets argued about at a
 * scale rather than noticed on a screen.
 */
export const WEIGHT: Unit[] = [
  { key: 'kg', label: 'kilograms (kg)', factor: 1, family: 'weight', digits: 1 },
  { key: 'g', label: 'grams (g)', factor: 0.001, family: 'weight', digits: 0 },
  { key: 'lb', label: 'pounds (lb)', factor: 0.45359237, family: 'weight', digits: 1 },
  { key: 'cwt', label: 'hundredweight (100 lb)', factor: 45.359237, family: 'weight', digits: 2 },
  { key: 't', label: 'tonnes (metric, 1000 kg)', factor: 1000, family: 'weight', digits: 3 },
  { key: 'ston', label: 'short tons (2000 lb)', factor: 907.18474, family: 'weight', digits: 3 },
]

/**
 * Distances, base = metre.
 *
 * Separate from depth, which is the same dimension used for a different job:
 * depth is millimetres of water on a field and tops out at a few feet, while
 * this runs to miles of pipe and pivot lengths.
 */
export const DISTANCE: Unit[] = [
  { key: 'm', label: 'metres (m)', factor: 1, family: 'distance', digits: 2 },
  { key: 'cm', label: 'centimetres (cm)', factor: 0.01, family: 'distance', digits: 1 },
  { key: 'in', label: 'inches', factor: 0.0254, family: 'distance', digits: 2 },
  { key: 'ft', label: 'feet', factor: 0.3048, family: 'distance', digits: 2 },
  { key: 'yd', label: 'yards', factor: 0.9144, family: 'distance', digits: 2 },
  { key: 'rod', label: 'rods (16.5 ft)', factor: 5.0292, family: 'distance', digits: 2 },
  { key: 'km', label: 'kilometres (km)', factor: 1000, family: 'distance', digits: 3 },
  { key: 'mi', label: 'miles', factor: 1609.344, family: 'distance', digits: 3 },
]

export const FAMILIES: Record<Family, Unit[]> = {
  volume: VOLUME,
  area: AREA,
  flow: FLOW,
  depth: DEPTH,
  weight: WEIGHT,
  distance: DISTANCE,
}

export function unit(family: Family, key: string): Unit | undefined {
  return FAMILIES[family].find((u) => u.key === key)
}

/** Convert a value between two units of the same family. */
export function convert(value: number, family: Family, from: string, to: string): number | null {
  const a = unit(family, from)
  const b = unit(family, to)
  if (!a || !b || !isFinite(value)) return null
  return (value * a.factor) / b.factor
}

// --- the calculations people actually want -----------------------------------

/**
 * Water needed to apply a depth over an area.
 * area in m², depth in mm → litres. (1 mm over 1 m² is exactly 1 litre.)
 */
export function volumeForDepth(areaM2: number, depthMm: number): number {
  return areaM2 * depthMm
}

/** Depth achieved by spreading a volume over an area. litres, m² → mm. */
export function depthForVolume(litres: number, areaM2: number): number | null {
  if (!areaM2) return null
  return litres / areaM2
}

/** Hours to deliver a volume at a flow rate. litres, L/s → hours. */
export function hoursForVolume(litres: number, flowLs: number): number | null {
  if (!flowLs) return null
  return litres / flowLs / 3600
}

/** "12 h 30 m" from a decimal hour count. */
export function formatHours(hours: number): string {
  if (!isFinite(hours) || hours < 0) return '—'
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  if (m === 60) return `${h + 1} h`
  return h > 0 ? `${h} h${m ? ` ${m} m` : ''}` : `${m} m`
}

/** Trim trailing zeros without losing precision on small numbers. */
export function fmt(value: number | null, digits = 2): string {
  if (value == null || !isFinite(value)) return '—'
  if (value !== 0 && Math.abs(value) < 0.001) return value.toExponential(2)
  const s = value.toLocaleString('en-CA', { maximumFractionDigits: digits })
  return s
}
