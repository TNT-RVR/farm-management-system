import type { FeatureCollection, MultiPolygon, Position } from 'geojson'
import type { MobNow } from './eshepherd'

/**
 * The herd, drawn on the paddock it is in.
 *
 * One label per occupied paddock, under the letter: "290 head · Home Ranch
 * Herd", and a second line when two mobs share it (the bulls run with the
 * cows). Placed at the middle of the paddock's biggest polygon, which is where
 * the letter already sits.
 */
export type HerdOnMap = {
  fc: FeatureCollection
  /** Pasture ids with a mob on them now, for the highlight. */
  occupied: string[]
}

/** The middle of the largest ring, by vertex average — close enough to sit a label on. */
export function labelPoint(geom: MultiPolygon): Position | null {
  let best: Position[] | null = null
  for (const poly of geom.coordinates) {
    const ring = poly[0]
    if (ring && (!best || ring.length > best.length)) best = ring
  }
  if (!best || best.length < 2) return null
  const pts = best.slice(0, -1)
  const [sx, sy] = pts.reduce(([x, y], [px, py]) => [x + px, y + py], [0, 0])
  return [sx / pts.length, sy / pts.length]
}

export function herdOnMap(
  pastures: { id: string; geojson: MultiPolygon | null }[],
  mobs: MobNow[],
): HerdOnMap {
  const byPasture = new Map<string, MobNow[]>()
  for (const m of mobs) {
    if (!m.pasture_id || m.no_fence) continue
    const list = byPasture.get(m.pasture_id) ?? []
    list.push(m)
    byPasture.set(m.pasture_id, list)
  }
  const fc: FeatureCollection = { type: 'FeatureCollection', features: [] }
  for (const p of pastures) {
    const list = byPasture.get(p.id)
    if (!list || !p.geojson) continue
    const at = labelPoint(p.geojson)
    if (!at) continue
    const head = list.reduce((s, m) => s + (m.head_count ?? 0), 0)
    const text = list
      .sort((a, b) => (b.head_count ?? 0) - (a.head_count ?? 0))
      .map((m) => `${m.head_count != null ? `${m.head_count} head · ` : ''}${m.mob}`)
      .join('\n')
    fc.features.push({
      type: 'Feature',
      id: p.id,
      properties: { pasture_id: p.id, text, head },
      geometry: { type: 'Point', coordinates: at },
    })
  }
  return { fc, occupied: [...byPasture.keys()] }
}
