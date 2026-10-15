/**
 * The topography surface, as the map needs it.
 *
 * Elevation comes from John Deere's field-operation exports — every logged
 * point carries a height in feet — gridded on a workstation and loaded here.
 * See docs/TOPOGRAPHY-COVERAGE-AUDIT.md for why there is no LiDAR behind it.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type TopoSurface = {
  id: string
  field_id: string
  field_name: string
  source_operation: string
  operation_type: string | null
  operation_date: string | null
  cell_m: number
  point_count: number
  cell_count: number
  min_ft: number
  max_ft: number
  relief_ft: number
  antenna_corrected: boolean
  machines: string[]
  note: string | null
}

export type TopoCell = {
  lon: number
  lat: number
  elev_ft: number
  rem_ft: number | null
  n_points: number
}

export function useTopoSurfaces() {
  return useQuery({
    queryKey: ['field_topo_surfaces'],
    queryFn: async (): Promise<TopoSurface[]> => {
      const { data, error } = await supabase
        .from('field_topo_surfaces_v')
        .select('*')
        .order('field_name')
      if (error) throw error
      return (data ?? []) as unknown as TopoSurface[]
    },
  })
}

/**
 * One cell as the database sends it: [lon, lat, elev_ft, rem_ft, n_points].
 *
 * A tuple rather than an object, and that is deliberate — 22,000 objects with
 * five repeated key names each is about 2.4 MB of mostly punctuation.
 */
export type PackedCell = [number, number, number, number | null, number]

export function unpackCell([lon, lat, elev_ft, rem_ft, n_points]: PackedCell): TopoCell {
  return { lon, lat, elev_ft, rem_ft, n_points }
}

export function useTopoCells(surfaceId: string | null) {
  return useQuery({
    enabled: Boolean(surfaceId),
    queryKey: ['field_topo_cells', surfaceId],
    queryFn: async (): Promise<TopoCell[]> => {
      // Through an RPC, not a table read, because PostgREST caps a response at
      // 1,000 rows and ITS limit wins over the client's: asking for 100,000
      // cells returned `Content-Range: 0-999/22306`. It then failed in the most
      // convincing way possible — with no ORDER BY, the surviving thousand were
      // in insertion order, which is the gridder scanning row-major from the
      // southern edge, so every field drew a tidy band across its south end and
      // looked like a small surface rather than a clipped one.
      //
      // A surface is one thing and now arrives as one thing.
      const { data, error } = await supabase.rpc('topo_cells', { p_surface: surfaceId! })
      if (error) throw error
      return ((data ?? []) as PackedCell[]).map(unpackCell)
    },
  })
}

/**
 * Below this, a surface is not a map.
 *
 * 200 cells at 5 m is about an acre and a quarter. Some tillage passes barely
 * entered the field — #11's covers SEVEN cells — and drawing those as a
 * "topography layer" would show a handful of dots on an empty quarter section
 * and teach somebody the feature is broken. They stay in the database, because
 * they are a true record of a pass; they just do not get offered as a surface.
 */
const MIN_CELLS = 200

/**
 * One surface per field: the one with the most ground under it.
 *
 * The puller chooses which operation to fetch by TYPE — harvest, then tillage,
 * then seeding — on the reasoning that a harvest logs four points per square
 * metre and a drill logs its own track. That holds on average and fails per
 * field: #11's tillage covers 7 cells where its seeding covers 2,872. Coverage
 * is the thing that was actually wanted, and after gridding it is known exactly,
 * so the choice is made here rather than guessed there.
 */
export function bestPerField(surfaces: TopoSurface[]): TopoSurface[] {
  const best = new Map<string, TopoSurface>()
  for (const s of surfaces) {
    if (s.cell_count < MIN_CELLS) continue
    const cur = best.get(s.field_id)
    if (!cur || s.cell_count > cur.cell_count) best.set(s.field_id, s)
  }
  return [...best.values()].sort((a, b) => a.field_name.localeCompare(b.field_name))
}

/** What the colour ramp is measuring. */
export type TopoMode = 'elevation' | 'rem'

/**
 * Where to put the colour breaks.
 *
 * ELEVATION uses the 2nd and 98th percentiles rather than the extremes. One
 * cell built from a single stray point can sit feet off its neighbours, and
 * stretching the whole ramp to reach it flattens the field into one colour —
 * which is exactly the failure that makes people distrust a map.
 *
 * REM is centred on zero and symmetric, because the question it answers is
 * "higher or lower than around it", and a ramp whose middle is not zero cannot
 * be read that way.
 */
export function colourStops(
  cells: Pick<TopoCell, 'elev_ft' | 'rem_ft'>[],
  mode: TopoMode,
): [number, number] {
  const values = cells
    .map((c) => (mode === 'rem' ? c.rem_ft : c.elev_ft))
    .filter((v): v is number => v != null && Number.isFinite(v))
    .sort((a, b) => a - b)
  if (!values.length) return [0, 1]

  if (mode === 'rem') {
    const spread = Math.max(
      Math.abs(values[Math.floor(values.length * 0.02)]),
      Math.abs(values[Math.floor(values.length * 0.98)]),
      0.5,
    )
    return [-spread, spread]
  }
  const lo = values[Math.floor(values.length * 0.02)]
  const hi = values[Math.floor(values.length * 0.98)]
  return lo === hi ? [lo - 0.5, hi + 0.5] : [lo, hi]
}

/** Five colour steps across the range, for the layer and the legend alike. */
export function rampSteps(
  [lo, hi]: [number, number],
  colours: string[],
): { value: number; colour: string }[] {
  return colours.map((colour, i) => ({
    value: lo + ((hi - lo) * i) / (colours.length - 1),
    colour,
  }))
}

/**
 * Circle radius in pixels, so a cell covers exactly the ground it stands for.
 *
 * The first attempt picked plausible-looking numbers by hand — 1 px at zoom 12,
 * 4 at 16, 48 at 20 — and they were wrong where it showed: at zoom 12 a 5 m
 * cell is four TENTHS of a pixel wide, so a 1 px dot draws it five times too
 * big and the field turns to mush, while the same stops under-draw elsewhere.
 * Guessing at this is unnecessary when the number is derivable.
 *
 * MapLibre uses 512 px tiles, so the ground covered by one pixel is
 * `40075017 * cos(latitude) / (512 * 2^zoom)` metres. Radius is half a cell
 * across that.
 *
 * A STOP PER ZOOM, with the floor already in each one. Two anchors would be
 * exact — the radius doubles with every level, so a base-2 exponential through
 * two points IS the curve — but the floor has nowhere to go in that form.
 * MapLibre refuses `['max', 0.6, ['interpolate', … ['zoom'] …]]` outright:
 * "zoom expression may only be used as input to a top-level step or
 * interpolate expression". And putting the floor on an anchor multiplies it
 * through every level above, which turned 0.5 px at zoom 10 into 32 px at zoom
 * 16 instead of 3.25. So the clamp is applied per stop, where it affects only
 * the levels that need it.
 */
export function radiusStops(cellM: number, lat: number): number[] {
  const metresPerPixel = (zoom: number) =>
    (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom)
  const stops: number[] = []
  for (let zoom = 8; zoom <= 22; zoom++) {
    // Below about half a pixel a circle stops being drawn at all, and a surface
    // that vanishes as you pull back reads as a surface that is not there.
    // Half the DIAGONAL, not half the side. A circle of radius s/2 inscribes
    // the square and leaves its four corners bare, which tiles as a lattice of
    // background showing through — visible on the live map as a grid over every
    // field. s·√2/2 circumscribes it instead, so neighbours overlap slightly
    // and the surface reads as ground rather than as dots.
    stops.push(zoom, Math.max(0.6, (cellM * Math.SQRT1_2) / metresPerPixel(zoom)))
  }
  return stops
}

/** Brown low ground to white high ground: how relief is read on paper. */
export const ELEVATION_COLOURS = ['#4a2c11', '#8c5a26', '#c9a227', '#d9d2b0', '#ffffff']
/** Blue hollow, pale neutral, red rise — the sign is what matters. */
export const REM_COLOURS = ['#1d4ed8', '#7dd3fc', '#f5f5f4', '#fca5a5', '#b91c1c']
