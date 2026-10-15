/**
 * The Profit/Loss Map drawn as contours: smoothed bands of $/acre with lines
 * at the band edges, like a weather map, instead of 20,000 dots.
 *
 * WHAT IT CHANGES AND WHAT IT DOES NOT. Smoothing only changes the picture.
 * The numbers — the field total, and the square a person taps — are the
 * unsmoothed ones, so nothing a decision rests on is blurred. The blur is
 * about two cells (10 m): enough that one noisy square cannot speckle the map,
 * not so much that a real wet spot disappears.
 *
 * Everything here is on the farm grid (pl-grid.ts), which is square in
 * latitude/longitude, so the finished raster drops onto the map as an image
 * with its corners at cell edges and needs no reprojection.
 */
import { DLAT, DLON } from './pl-grid'

export type Raster = {
  /** Cell index of the raster's first column and first (southernmost) row. */
  gx0: number
  gy0: number
  w: number
  h: number
  /** Row-major from the SOUTH edge. NaN where there is no data. */
  v: Float32Array
}

export function rasterize(cells: { gx: number; gy: number; value: number }[]): Raster | null {
  if (!cells.length) return null
  let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity
  for (const c of cells) {
    gx0 = Math.min(gx0, c.gx)
    gy0 = Math.min(gy0, c.gy)
    gx1 = Math.max(gx1, c.gx)
    gy1 = Math.max(gy1, c.gy)
  }
  const w = gx1 - gx0 + 1
  const h = gy1 - gy0 + 1
  const v = new Float32Array(w * h).fill(NaN)
  for (const c of cells) v[(c.gy - gy0) * w + (c.gx - gx0)] = c.value
  return { gx0, gy0, w, h, v }
}

/**
 * Gaussian blur that ignores empty cells rather than treating them as zero,
 * so the field edge does not fade toward break-even. Empty cells stay empty,
 * except a hole almost surrounded by data (a missed square in the middle of
 * the crop), which is filled so the map has no pinholes.
 */
export function smooth(r: Raster, sigmaCells = 1.2): Raster {
  const rad = Math.max(1, Math.ceil(sigmaCells * 2.5))
  const k: number[] = []
  for (let i = -rad; i <= rad; i++) k.push(Math.exp(-(i * i) / (2 * sigmaCells * sigmaCells)))
  const pass = (src: Float32Array, dx: number, dy: number) => {
    const out = new Float32Array(src.length).fill(NaN)
    const wsum = new Float32Array(src.length)
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++) {
        let s = 0, ws = 0
        for (let i = -rad; i <= rad; i++) {
          const xx = x + i * dx, yy = y + i * dy
          if (xx < 0 || yy < 0 || xx >= r.w || yy >= r.h) continue
          const val = src[yy * r.w + xx]
          if (Number.isNaN(val)) continue
          s += val * k[i + rad]
          ws += k[i + rad]
        }
        const idx = y * r.w + x
        wsum[idx] = ws
        if (ws > 0) out[idx] = s / ws
      }
    return out
  }
  const blurred = pass(pass(r.v, 1, 0), 0, 1)
  const out = new Float32Array(r.v.length).fill(NaN)
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const i = y * r.w + x
      if (!Number.isNaN(r.v[i])) {
        out[i] = blurred[i]
        continue
      }
      let n = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy
          if ((dx || dy) && xx >= 0 && yy >= 0 && xx < r.w && yy < r.h && !Number.isNaN(r.v[yy * r.w + xx])) n++
        }
      if (n >= 6) out[i] = blurred[i]
    }
  return { ...r, v: out }
}

/**
 * Band edges at a round step, always including zero when the range spans it,
 * so break-even is a line on the map and not somewhere inside a band.
 */
export function bandBreaks([lo, hi]: [number, number], target = 8): number[] {
  const span = hi - lo
  if (!(span > 0)) return [lo]
  const raw = span / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  const out: number[] = []
  for (let b = Math.ceil(lo / step) * step; b <= hi + 1e-9; b += step) out.push(Math.round(b * 1e6) / 1e6)
  return out
}

/** Bilinear value at a fractional cell position, NaN if any corner is empty. */
function sample(r: Raster, fx: number, fy: number): number {
  const x0 = Math.floor(fx), y0 = Math.floor(fy)
  const tx = fx - x0, ty = fy - y0
  const at = (x: number, y: number) => {
    const cx = Math.min(r.w - 1, Math.max(0, x)), cy = Math.min(r.h - 1, Math.max(0, y))
    return r.v[cy * r.w + cx]
  }
  const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1)
  const corners = [a, b, c, d].filter((q) => !Number.isNaN(q))
  if (!corners.length) return NaN
  // At the field edge, fill a missing corner with the mean of the others
  // rather than losing half a cell of crop at every boundary.
  const m = corners.reduce((s, q) => s + q, 0) / corners.length
  const [A, B, C, D] = [a, b, c, d].map((q) => (Number.isNaN(q) ? m : q))
  return (A * (1 - tx) + B * tx) * (1 - ty) + (C * (1 - tx) + D * tx) * ty
}

/**
 * The raster at `scale` pixels per cell, row-major from the NORTH edge (image
 * order). Pixels outside the data are NaN. Sampled at pixel centres, with
 * cell values at cell centres, so bands meet smoothly between cells.
 */
export function upsample(r: Raster, scale = 4): { w: number; h: number; v: Float32Array } {
  const W = r.w * scale, H = r.h * scale
  const v = new Float32Array(W * H).fill(NaN)
  for (let py = 0; py < H; py++) {
    const fy = (H - py - 0.5) / scale - 0.5 // image rows run north to south
    const cy = Math.round(fy)
    for (let px = 0; px < W; px++) {
      const fx = (px + 0.5) / scale - 0.5
      const cx = Math.round(fx)
      // Clip to the cells that have data, so the field keeps its own edge.
      if (cx < 0 || cy < 0 || cx >= r.w || cy >= r.h || Number.isNaN(r.v[cy * r.w + cx])) continue
      v[py * W + px] = sample(r, fx, fy)
    }
  }
  return { w: W, h: H, v }
}

/** Which band a value is in: 0 below the first break, breaks.length above the last. */
export function bandOf(value: number, breaks: number[]): number {
  let i = 0
  while (i < breaks.length && value >= breaks[i]) i++
  return i
}

/** Where the image goes on the map: its corners, NW clockwise, as MapLibre wants. */
export function imageCorners(r: Raster): [[number, number], [number, number], [number, number], [number, number]] {
  const west = r.gx0 * DLON, east = (r.gx0 + r.w) * DLON
  const south = r.gy0 * DLAT, north = (r.gy0 + r.h) * DLAT
  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ]
}

/**
 * Contour lines at each break, by marching squares over the upsampled image.
 * Returned as line segments in longitude/latitude, one list per break.
 */
export function contourLines(
  img: { w: number; h: number; v: Float32Array },
  breaks: number[],
  corners: ReturnType<typeof imageCorners>,
): { value: number; segments: [number, number][][] }[] {
  const [[west, north], [east], , [, south]] = corners
  const lon = (x: number) => west + ((x + 0.5) / img.w) * (east - west)
  const lat = (y: number) => north - ((y + 0.5) / img.h) * (north - south)
  const at = (x: number, y: number) => img.v[y * img.w + x]
  const out: { value: number; segments: [number, number][][] }[] = []
  for (const level of breaks) {
    const segs: [number, number][][] = []
    for (let y = 0; y < img.h - 1; y++)
      for (let x = 0; x < img.w - 1; x++) {
        const a = at(x, y), b = at(x + 1, y), c = at(x + 1, y + 1), d = at(x, y + 1)
        if ([a, b, c, d].some(Number.isNaN)) continue
        const idx = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0)
        if (idx === 0 || idx === 15) continue
        const t = (p: number, q: number) => (level - p) / (q - p)
        const top: [number, number] = [lon(x + t(a, b)), lat(y)]
        const right: [number, number] = [lon(x + 1), lat(y + t(b, c))]
        const bottom: [number, number] = [lon(x + t(d, c)), lat(y + 1)]
        const left: [number, number] = [lon(x), lat(y + t(a, d))]
        const push = (p: [number, number], q: [number, number]) => segs.push([p, q])
        switch (idx) {
          case 1: case 14: push(left, bottom); break
          case 2: case 13: push(bottom, right); break
          case 3: case 12: push(left, right); break
          case 4: case 11: push(top, right); break
          case 6: case 9: push(top, bottom); break
          case 7: case 8: push(left, top); break
          case 5: push(left, top); push(bottom, right); break
          case 10: push(top, right); push(left, bottom); break
        }
      }
    if (segs.length) out.push({ value: level, segments: segs })
  }
  return out
}

/** A hex colour at `t` of the way along a list of stops. */
export function colourAt(stops: { value: number; colour: string }[], value: number): [number, number, number] {
  const rgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
  if (value <= stops[0].value) return rgb(stops[0].colour)
  for (let i = 1; i < stops.length; i++) {
    if (value <= stops[i].value) {
      const a = stops[i - 1], b = stops[i]
      const t = (value - a.value) / (b.value - a.value || 1)
      const [r1, g1, b1] = rgb(a.colour), [r2, g2, b2] = rgb(b.colour)
      return [r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t].map(Math.round) as [number, number, number]
    }
  }
  return rgb(stops[stops.length - 1].colour)
}
