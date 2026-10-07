// Which map pins are drinking water, and which only sound like it.
//
// Sam's Google My Map already carries the water: dugouts, ponds, watering
// holes. It also carries pivots, pumps and turbines, which are about water in
// the sense that they move it and about which cattle care not at all. Grazing
// distance is measured from where an animal can put its head down.
//
// Matching on name is admittedly crude, but the pins come from a map he edits
// directly — there are no types or tags to key on, only what he called things.

/** Things cattle drink from. */
export const WATER_WORDS = [
  'pond',
  'dugout',
  'watering hole',
  'water hole',
  'waterhole',
  'trough',
  'waterer',
  'spring',
  'dam',
  'reservoir',
  'slough',
]

/**
 * Things with water in the name that cattle cannot drink from.
 *
 * Checked FIRST and unconditionally: "water pump" and "pivot pond" both contain
 * an included word, and treating either as a drinking source would place a
 * grazing radius around infrastructure. Excluding wrongly costs one paddock its
 * underutilisation reading; including wrongly puts a confident 800 m circle
 * around a pump housing.
 */
export const NOT_WATER_WORDS = [
  'pivot',
  'turbine',
  'pump',
  'hydrant',
  'valve',
  'pipeline',
  'riser',
  'meter',
  'well head',
  'wellhead',
]

export function isWaterSourceName(name: string | null | undefined): boolean {
  if (!name) return false
  const n = name.toLowerCase()
  if (NOT_WATER_WORDS.some((w) => n.includes(w))) return false
  return WATER_WORDS.some((w) => n.includes(w))
}

export type WaterPoint = { lat: number; lon: number; name: string }

/**
 * Pull the drinkable water points out of a My Map feature collection.
 *
 * Points only. A dugout drawn as a polygon would need a centroid, and guessing
 * which edge of it the cattle stand at is not something to infer silently —
 * those are better re-marked as a pin.
 */
export function waterPointsFrom(features: GeoJSON.Feature[]): WaterPoint[] {
  const out: WaterPoint[] = []
  for (const f of features) {
    if (f.geometry?.type !== 'Point') continue
    const props = (f.properties ?? {}) as Record<string, unknown>
    const name = String(props.name ?? props.Name ?? '')
    if (!isWaterSourceName(name)) continue
    const [lon, lat] = f.geometry.coordinates as [number, number]
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    out.push({ lat, lon, name })
  }
  return out
}
