/**
 * The farm-wide grid the Profit/Loss Map is built on.
 *
 * ONE GRID FOR THE WHOLE FARM, fixed in latitude and longitude. The seeding,
 * each spray pass and the harvest are gridded separately, on different days,
 * by a function that sees one export at a time; they only add up if a cell
 * index means the same square of ground in all of them. A grid anchored per
 * export (at its first point, or its centroid) would shift between passes and
 * smear every cost across its neighbours.
 *
 * Why not UTM: this needs no projection library in the Netlify function or the
 * browser, and every field is between 49.6 and 50.1 degrees north. Fixing the
 * longitude step at REF_LAT makes a cell 5 m wide there and within 3 cm of it
 * anywhere on the farm.
 */

export const CELL_M = 5
const REF_LAT = 49.85
export const M_PER_DEG_LAT = 111_132
export const M_PER_DEG_LON = 111_320 * Math.cos((REF_LAT * Math.PI) / 180)

export const DLAT = CELL_M / M_PER_DEG_LAT
export const DLON = CELL_M / M_PER_DEG_LON

export const CELL_M2 = CELL_M * CELL_M
const M2_PER_ACRE = 4046.8564224
export const CELL_ACRES = CELL_M2 / M2_PER_ACRE
export const FT = 0.3048

export function cellOf(lon: number, lat: number): [number, number] {
  return [Math.floor(lon / DLON), Math.floor(lat / DLAT)]
}

export function centreOf(gx: number, gy: number): [number, number] {
  return [(gx + 0.5) * DLON, (gy + 0.5) * DLAT]
}

/** One gridded layer as stored: [gx, gy, rate, covered]. */
export type PackedCell = [number, number, number, number]

export const cellKey = (gx: number, gy: number) => `${gx},${gy}`

/**
 * Bins logged points into cells.
 *
 * Every point stands for the patch of ground the machine covered since the one
 * before: its swath width times the distance travelled. So a cell's RATE is
 * the area-weighted mean of the points in it, and its COVERAGE is the logged
 * area over the cell's area. Coverage over 1 is an overlap and under 1 a skip,
 * and both are real costs: product that went on twice, or ground that got
 * none.
 */
export class GridAccumulator {
  private cells = new Map<string, { gx: number; gy: number; rateArea: number; area: number }>()
  points = 0

  add(lon: number, lat: number, rate: number, areaM2: number) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(rate)) return
    if (!(areaM2 > 0)) return
    const [gx, gy] = cellOf(lon, lat)
    const k = cellKey(gx, gy)
    let c = this.cells.get(k)
    if (!c) {
      c = { gx, gy, rateArea: 0, area: 0 }
      this.cells.set(k, c)
    }
    c.rateArea += rate * areaM2
    c.area += areaM2
    this.points++
  }

  /**
   * A point whose swath is wider than a cell, spread across that width.
   *
   * A spreader or a single-section boom logs one point for its whole swath —
   * 27 m on the urea pass over #5 — and dropping all of that into the one cell
   * under the antenna put five times the product on a fifth of the field and
   * none on the rest: a striped map of the logging, not of the field. So the
   * swath is laid out across the direction of travel in slices no wider than
   * half a cell, each carrying its share of the area. Narrow swaths, like a
   * sprayer section, still go in one cell.
   */
  addSwath(lon: number, lat: number, rate: number, widthM: number, distM: number, headingDeg: number | null) {
    if (!(widthM > CELL_M) || headingDeg == null || !Number.isFinite(headingDeg)) {
      this.add(lon, lat, rate, widthM * distM)
      return
    }
    const slices = Math.ceil(widthM / (CELL_M / 2))
    const h = (headingDeg * Math.PI) / 180
    // Heading is clockwise from north; across-track is 90 degrees from it.
    const eastPerM = Math.cos(h) / M_PER_DEG_LON
    const northPerM = -Math.sin(h) / M_PER_DEG_LAT
    const area = (widthM * distM) / slices
    for (let i = 0; i < slices; i++) {
      const off = ((i + 0.5) / slices - 0.5) * widthM
      this.add(lon + off * eastPerM, lat + off * northPerM, rate, area)
    }
    // One logged point, however many slices it was laid across.
    this.points -= slices - 1
  }

  get size() {
    return this.cells.size
  }

  packed(): PackedCell[] {
    const out: PackedCell[] = []
    for (const c of this.cells.values()) {
      out.push([c.gx, c.gy, round(c.rateArea / c.area, 4), round(c.area / CELL_M2, 3)])
    }
    return out
  }
}

const round = (v: number, dp: number) => {
  const f = 10 ** dp
  return Math.round(v * f) / f
}
