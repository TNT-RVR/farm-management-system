/**
 * The Profit/Loss Map's arithmetic: what each 5 m square made or lost.
 *
 *   profit per acre = yield × price − mapped inputs − flat costs
 *
 * MAPPED INPUTS are seed, fertilizer and chemical, placed where the machine
 * actually put them. Each pass's DOLLARS come from the price book the same way
 * the field's input card prices them; the as-applied grid only decides WHERE
 * those dollars landed. So the map and the field totals cannot disagree:
 * spreading a pass's cost by its own applied amount conserves the total, and
 * an overlap costs double exactly where it happened.
 *
 * FLAT COSTS are the ones no machine logs (fuel, labour, land...). They lower
 * every square equally, so they move the colours but not the pattern.
 *
 * YIELD has three sources, because not every harvest logs one:
 *  - `file`: a yield monitor (FarmTRX or a Deere combine) logged it per point.
 *    Calibrated to the scale total when there is one, because the scale is
 *    what got paid for.
 *  - `even`: the scale total spread flat. Revenue is the same everywhere, so
 *    the map shows only where the costs differed.
 *  - `vigour`: the scale total spread in proportion to mid-season satellite
 *    vigour. An estimate, and labelled as one; the field total is still the
 *    scale's.
 */
import { CELL_ACRES, cellKey, type PackedCell } from './pl-grid'

export type YieldMode = 'file' | 'even' | 'vigour'

export type GridRow = {
  operation_id: string | null
  operation_type: string
  kind: 'input' | 'yield' | 'coverage'
  product_hash: string
  product_name: string | null
  rate_unit: string | null
  cells: PackedCell[]
  point_count: number
}

export type PlCell = {
  gx: number
  gy: number
  /** Per acre, in the crop's yield unit. */
  yield: number
  revenue: number
  mapped: number
  flat: number
  profit: number
  /**
   * True where a yield file covers the field but had no reading here, so the
   * square carries the field average. Drawn hatched: it is unknown ground,
   * not ground that yielded exactly the average.
   */
  estimated: boolean
}

export type PlInputs = {
  grids: GridRow[]
  /** Dollars to lay down where each pass went, by operation id (profit-loss-lines forMap). */
  placed: Map<string, number>
  mode: YieldMode
  /** The main crop's yield per acre, in its unit. */
  scaleYieldPerAcre: number | null
  price: number | null
  /** Costs with nowhere particular to go, spread evenly. */
  flatPerAcre: number
  /** Revenue that is not the main crop (a straw sale), spread evenly. */
  otherRevenuePerAcre?: number
  /** Satellite vigour per cell, for `vigour` mode. */
  vigour?: Map<string, number>
}

/** Where the crop was. The harvest's own footprint when it logged one. */
export function harvestedCells(grids: GridRow[]): PackedCell[] {
  const pick = (kind: GridRow['kind']) =>
    grids.filter((g) => g.kind === kind).sort((a, b) => b.point_count - a.point_count)[0]
  const footprint = pick('coverage') ?? pick('yield')
  if (footprint) {
    // A cell the header barely clipped on a turn is not a square of crop.
    return fillHoles(footprint.cells.filter((c) => c[3] >= 0.25))
  }
  // No harvest logged: the union of everything that went on the field.
  const seen = new Map<string, PackedCell>()
  for (const g of grids) for (const c of g.cells) seen.set(cellKey(c[0], c[1]), c)
  return [...seen.values()]
}

/**
 * Closes the gaps inside a harvest footprint without growing its outside.
 *
 * Two kinds of gap showed on the map as streaks of bare ground: a diagonal
 * chain of squares a combine only clipped crossing Moreaus at an angle, and
 * whole north-south strips one to four squares wide between passes on #5
 * where the logging left a seam. Neither was ground left standing.
 *
 * A morphological closing: grow the footprint by CLOSE_CELLS in every
 * direction, then shrink it back by the same. Any gap up to twice that wide
 * fills; the outer edge, and any notch wider than that (the unharvested
 * corner on Moreaus' east side is twenty squares across), comes back exactly
 * where it was.
 */
export const CLOSE_CELLS = 2

export function fillHoles(cells: PackedCell[], r = CLOSE_CELLS): PackedCell[] {
  const have = new Set(cells.map((c) => cellKey(c[0], c[1])))
  // Grow.
  const grown = new Set<string>()
  for (const [gx, gy] of cells)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) grown.add(cellKey(gx + dx, gy + dy))
  // Shrink: a grown square stays only if everything within r of it is grown.
  const out = [...cells]
  for (const k of grown) {
    if (have.has(k)) continue
    const [gx, gy] = k.split(',').map(Number)
    let keep = true
    for (let dy = -r; dy <= r && keep; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (!grown.has(cellKey(gx + dx, gy + dy))) {
          keep = false
          break
        }
    if (keep) out.push([gx, gy, 1, 1])
  }
  return out
}

/**
 * Where one pass's dollars landed.
 *
 * Weighted by the product actually applied in each cell (rate × coverage). A
 * tank mix has a layer per product; the most-logged one is the pattern,
 * because every product in a mix goes on together.
 */
export function spreadPassCost(layers: GridRow[], dollars: number): Map<string, number> {
  const out = new Map<string, number>()
  const pattern = [...layers].sort((a, b) => b.point_count - a.point_count)[0]
  if (!pattern || !(dollars > 0)) return out
  let total = 0
  for (const c of pattern.cells) total += c[2] * c[3]
  if (!(total > 0)) return out
  for (const c of pattern.cells) {
    const share = (c[2] * c[3]) / total
    // Per acre of that cell.
    out.set(cellKey(c[0], c[1]), (dollars * share) / CELL_ACRES)
  }
  return out
}

export function profitCells(inp: PlInputs): PlCell[] {
  const cells = harvestedCells(inp.grids)
  if (!cells.length) return []

  // Mapped cost per acre per cell, summed over passes.
  const mapped = new Map<string, number>()
  const byOp = new Map<string, GridRow[]>()
  for (const g of inp.grids) {
    if (g.kind !== 'input' || !g.operation_id) continue
    const list = byOp.get(g.operation_id) ?? []
    list.push(g)
    byOp.set(g.operation_id, list)
  }
  for (const [op, layers] of byOp) {
    const dollars = inp.placed.get(op)
    if (dollars == null) continue
    for (const [k, v] of spreadPassCost(layers, dollars)) mapped.set(k, (mapped.get(k) ?? 0) + v)
  }

  const yields = yieldPerCell(inp, cells)
  const price = inp.price ?? 0
  // With a yield file, squares it never read carry the field average.
  const fileLayer = inp.mode === 'file' ? inp.grids.find((g) => g.kind === 'yield') : undefined
  const read = fileLayer ? new Set(fileLayer.cells.map((c) => cellKey(c[0], c[1]))) : null
  return cells.map((c) => {
    const k = cellKey(c[0], c[1])
    const y = yields.get(k) ?? 0
    const revenue = y * price + (inp.otherRevenuePerAcre ?? 0)
    const m = mapped.get(k) ?? 0
    return {
      gx: c[0],
      gy: c[1],
      yield: y,
      revenue,
      mapped: m,
      flat: inp.flatPerAcre,
      profit: revenue - m - inp.flatPerAcre,
      estimated: read != null && !read.has(k),
    }
  })
}

function yieldPerCell(inp: PlInputs, cells: PackedCell[]): Map<string, number> {
  const out = new Map<string, number>()
  const avg = inp.scaleYieldPerAcre

  if (inp.mode === 'file') {
    const layer = inp.grids.filter((g) => g.kind === 'yield').sort((a, b) => b.point_count - a.point_count)[0]
    if (!layer) return out
    const logged = new Map(layer.cells.map((c) => [cellKey(c[0], c[1]), c[2]]))
    const values = cells.map((c) => logged.get(cellKey(c[0], c[1]))).filter((v): v is number => v != null)
    const mean = values.reduce((s, v) => s + v, 0) / (values.length || 1)
    // Monitors drift; the scale does not. Keep the monitor's pattern, the scale's level.
    const scale = avg != null && mean > 0 ? avg / mean : 1
    for (const c of cells) {
      const k = cellKey(c[0], c[1])
      out.set(k, (logged.get(k) ?? mean) * scale)
    }
    return out
  }

  if (avg == null) return out
  if (inp.mode === 'vigour' && inp.vigour?.size) {
    const values = cells.map((c) => inp.vigour!.get(cellKey(c[0], c[1]))).filter((v): v is number => v != null && v > 0)
    const mean = values.reduce((s, v) => s + v, 0) / (values.length || 1)
    for (const c of cells) {
      const v = inp.vigour.get(cellKey(c[0], c[1]))
      // A cell with no reading (cloud, edge) gets the average, not zero.
      out.set(cellKey(c[0], c[1]), v != null && v > 0 && mean > 0 ? avg * (v / mean) : avg)
    }
    return out
  }
  for (const c of cells) out.set(cellKey(c[0], c[1]), avg)
  return out
}

/** Share of the harvested ground that lost money. */
export function losingShare(cells: PlCell[]): number {
  return cells.length ? cells.filter((c) => c.profit < 0).length / cells.length : 0
}

/** A colour range centred on break-even, clipped so one wild cell cannot flatten the rest. */
export function profitRange(cells: PlCell[]): [number, number] {
  const v = cells.map((c) => c.profit).sort((a, b) => a - b)
  if (!v.length) return [-1, 1]
  const lo = v[Math.floor(v.length * 0.02)]
  const hi = v[Math.min(v.length - 1, Math.floor(v.length * 0.98))]
  return [lo, hi]
}

/** Red for losing money, pale at break-even, green for making it. */
export const LOSS_COLOURS = ['#991b1b', '#ef4444', '#fca5a5']
export const EVEN_COLOUR = '#fefce8'
export const PROFIT_COLOURS = ['#bbf7d0', '#22c55e', '#166534']

/** Colour steps for a range of $/ac, shared by the field map and the farm map. */
export function colourStops([lo, hi]: [number, number]) {
  // Green only when everything made money, red only when everything lost it:
  // a diverging ramp would waste half its colours on a side nothing is on.
  if (lo >= 0) {
    const h = hi > lo ? hi : lo + 1
    return [lo, (lo + h) / 2, h].map((value, i) => ({ value, colour: PROFIT_COLOURS[i] }))
  }
  if (hi <= 0) {
    const l = lo < hi ? lo : hi - 1
    return [l, (l + hi) / 2, hi].map((value, i) => ({ value, colour: LOSS_COLOURS[i] }))
  }
  return [
    { value: lo, colour: LOSS_COLOURS[0] },
    { value: lo / 2, colour: LOSS_COLOURS[1] },
    { value: 0, colour: EVEN_COLOUR },
    { value: hi / 2, colour: PROFIT_COLOURS[1] },
    { value: hi, colour: PROFIT_COLOURS[2] },
  ]
}
