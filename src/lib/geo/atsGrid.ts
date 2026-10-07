import { atsBox, reverseLld, type AtsBox, type LatLng, type TownshipTable } from './ats'

// The quarter-section grid over whatever the map is currently showing.
//
// Built by sampling rather than by walking township/range/section arithmetic.
// The survey grid is not a regular lattice — townships shift at correction
// lines and ranges narrow going north — so stepping "one section east" from a
// known parcel is exactly the kind of arithmetic that drifts a row out of place
// after a few steps. Asking "what parcel is this point in" is the operation the
// survey table already answers correctly, so the grid is assembled from those
// answers.

export type Bounds = { south: number; west: number; north: number; east: number }

export type GridParcel = {
  /** Canonical description, e.g. `SW-35-68-21-W4`. */
  text: string
  /**
   * What goes on the map: `SW 35-68-21`.
   *
   * The quarter alone was ambiguous — four quarters of neighbouring sections
   * all read "NW" and told you nothing about which section you were over. The
   * meridian is dropped because every parcel on this farm is W4, so printing it
   * on every label costs width and adds nothing.
   */
  label: string
  box: AtsBox
  /**
   * True when this parcel came from the computed grid rather than the survey.
   *
   * Outside Alberta there is no survey data, so `reverseLld` falls back to a
   * ~300 m estimate — a third of a quarter section. Drawn unmarked, an
   * estimated line is indistinguishable from a surveyed one and so reads as
   * authoritative, which is the one thing an overlay like this must not do.
   * The identify tool already says "Estimated — no survey data here"; this is
   * the same honesty for the grid, and it is per parcel because a view
   * straddling the Saskatchewan border contains both kinds at once.
   */
  estimated: boolean
}

/** `SW 35-68-21` — the description without the meridian. */
export function gridLabel(parts: {
  quarter: string | null
  section: number
  township: number
  range: number
}): string {
  const body = `${parts.section}-${parts.township}-${parts.range}`
  return parts.quarter ? `${parts.quarter} ${body}` : body
}

/** Metres per degree, near enough at Alberta latitudes. */
const M_PER_DEG_LAT = 111_132
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)

/**
 * A quarter section is half a mile — about 805 m — so sampling every 200 m
 * cannot step over one. Tighter would cost work for no more coverage.
 */
const SAMPLE_M = 200

/**
 * Every quarter section overlapping `bounds`.
 *
 * `limit` stops a zoomed-out view from generating thousands of parcels: the
 * caller is expected not to draw the grid at that scale at all, and returning a
 * partial grid would be worse than none — a map showing lines over half the
 * screen reads as "there is nothing there", which is false.
 */
export function quartersInView(
  bounds: Bounds,
  table: TownshipTable | null | undefined,
  limit = 600,
): GridParcel[] {
  const { south, west, north, east } = bounds
  if (!(north > south) || !(east > west)) return []

  const midLat = (north + south) / 2
  const latStep = SAMPLE_M / M_PER_DEG_LAT
  const lngStep = SAMPLE_M / mPerDegLng(midLat)
  if (!Number.isFinite(latStep) || !Number.isFinite(lngStep) || lngStep <= 0) return []

  // Refuse rather than truncate: a half-drawn grid is a lie about the ground.
  const samples = ((north - south) / latStep + 1) * ((east - west) / lngStep + 1)
  if (samples > 20_000) return []

  const found = new Map<string, GridParcel>()
  for (let lat = south; lat <= north + latStep; lat += latStep) {
    for (let lng = west; lng <= east + lngStep; lng += lngStep) {
      const p: LatLng = { lat, lng }
      const r = reverseLld(p, table)
      if (!r) continue
      if (found.has(r.text)) continue
      // Tiled, so the outlines meet. Drawn at surveyed size the road
      // allowance shows as a gap between every pair of sections, which reads as
      // a broken overlay — and contradicts reverseLld, which tiles on the pitch
      // so no point falls between two parcels.
      const box = atsBox(r.parts, table, { tile: true })
      if (!box) continue
      found.set(r.text, {
        text: r.text,
        label: gridLabel(r.parts),
        box,
        estimated: r.source !== 'survey',
      })
      if (found.size > limit) return []
    }
  }
  return [...found.values()]
}

/** Quarter outlines and label points, ready for a map source. */
export function quarterGridGeoJson(parcels: GridParcel[]) {
  return {
    type: 'FeatureCollection' as const,
    features: parcels.map((p) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [p.box.ring.map((c) => [c.lng, c.lat] as [number, number])],
      },
      properties: { text: p.text, label: p.label, estimated: p.estimated },
    })),
  }
}
