import type { Position } from 'geojson'
import {
  FIT_WORDS,
  PEN_SPACE,
  areaFt2,
  boundsCentre,
  fitScale,
  framedBounds,
  inventoryStatus,
  isLinear,
  itemEnds,
  layoutBounds,
  partsList,
  penCapacity,
  penFit,
  scaleBar,
  toLocalFt,
} from './handling'
import type { CatalogRow, ItemRow, PathRow } from './handling-data'
import { downloadBlob, tableReportToPdf, type Cell, type TableReport } from './table-report'

/**
 * The plan you take out to the yard: the layout drawn to scale, what it is
 * built from, and whether you own it.
 *
 * The one thing the designer could not do that a build needs. Everything else
 * about this tool is for deciding; this is for handing to whoever is setting
 * the panels, who is not going to be holding a phone with the right layout
 * open on it.
 *
 * It goes through the app's one report pipeline (table-report), so it gets the
 * farm's letterhead, the repeating table headers and the page numbering that
 * every other printed thing here has. The drawing rides along as the report's
 * picture.
 */

const PAPER = { w: 1500, h: 950 }
/** Drawn at twice the size and scaled down, so the lines are not soft in print. */
const OVERSAMPLE = 2

export type PlanInput = {
  yardName: string
  ranchName: string | null
  layoutName: string
  catalog: CatalogRow[]
  items: ItemRow[]
  paths: PathRow[]
  /** Head worked out for each pen, the same figures the screen shows. */
  penHead: Record<string, number>
  owned: Record<string, number>
  now?: Date
}

const FIT_COLOR: Record<string, string> = {
  empty: '#a16207',
  fits: '#15803d',
  marginal: '#c2410c',
  over: '#b91c1c',
}

/** Above this the line is too pale to read as ink on white. */
const INK_CEILING = 120
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/**
 * A kit colour, darkened enough to be ink.
 *
 * The map's colours are chosen to stand out against a satellite photo of a
 * dirt yard, so they are bright, and a bright line on white paper is a faint
 * one — a mint gate at 3.5 px all but disappears. Paper is the opposite
 * problem to the screen and gets the opposite treatment: the hue is what says
 * which category a line belongs to, so that is kept and only the lightness
 * comes down, until the line is dark enough to read.
 *
 * Which is why the fit colours above are their own darker set rather than the
 * map's. This does the same thing for the colours Sam can edit, where there
 * is no second set to pick from.
 */
export function ink(hex: string): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  if (full.length !== 6) return hex
  const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  if (rgb.some(Number.isNaN)) return hex
  const l = lum(rgb[0], rgb[1], rgb[2])
  if (l <= INK_CEILING) return hex
  const k = INK_CEILING / l
  return `#${rgb.map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('')}`
}

/* ── The drawing ───────────────────────────────────────────────────────────── */

export type Drawing = { dataUrl: string; width: number; height: number }

/**
 * The layout as a picture, seen from above and to scale.
 *
 * A canvas rather than the screen's SVG: the report pipeline takes a picture,
 * and re-drawing here means the plan is not at the mercy of whatever the map
 * happened to be zoomed to — it frames the yard itself, at a scale printed on
 * the sheet beside a bar you can lay a ruler against.
 *
 * Returns null where there is no canvas to draw on (a test, a worker) or
 * nothing to draw. The report then prints its tables without a picture rather
 * than failing.
 */
export function planDrawing(input: PlanInput): Drawing | null {
  const { items, paths, catalog, penHead } = input
  const bounds = framedBounds(layoutBounds(items, paths), 120)
  if (!bounds) return null

  let canvas: HTMLCanvasElement
  try {
    canvas = document.createElement('canvas')
  } catch {
    return null
  }
  canvas.width = PAPER.w * OVERSAMPLE
  canvas.height = PAPER.h * OVERSAMPLE
  const g = canvas.getContext('2d')
  if (!g) return null
  g.scale(OVERSAMPLE, OVERSAMPLE)
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, PAPER.w, PAPER.h)

  const origin = boundsCentre(bounds)
  const sw = toLocalFt(origin, bounds[0])
  const ne = toLocalFt(origin, bounds[1])
  const { scale, cx, cy } = fitScale({ w: ne.x - sw.x, h: ne.y - sw.y }, PAPER, 46)
  // North is up and y grows downward, so the northing flips.
  const at = (p: Position) => {
    const l = toLocalFt(origin, p)
    return { x: cx + l.x * scale, y: cy - l.y * scale }
  }
  const byId = new Map(catalog.map((c) => [c.id, c]))

  /** One point turned about another. Canvas y grows down, so this is clockwise. */
  const turned = (p: { x: number; y: number }, about: { x: number; y: number }, deg: number) => {
    const t = (deg * Math.PI) / 180
    const dx = p.x - about.x
    const dy = p.y - about.y
    return { x: about.x + dx * Math.cos(t) - dy * Math.sin(t), y: about.y + dx * Math.sin(t) + dy * Math.cos(t) }
  }

  // Pens first: they are the ground the kit stands on.
  for (const p of paths) {
    if (!p.points.length) continue
    const pts = p.points.map(at)
    const sqft = p.is_closed ? areaFt2(p.points) : 0
    const cap = p.is_closed ? penCapacity(sqft, p.usage_type) : null
    const head = penHead[p.id] ?? 0
    const colour = p.is_closed && cap ? FIT_COLOR[penFit(head, cap)] : ink(p.color)

    g.beginPath()
    pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)))
    if (p.is_closed) g.closePath()
    g.setLineDash(p.is_closed ? [] : [10, 6])
    g.strokeStyle = colour
    g.lineWidth = 2
    if (p.is_closed) {
      g.fillStyle = colour + '18'
      g.fill()
    }
    g.stroke()
    g.setLineDash([])

    if (p.is_closed && cap) {
      const mid = {
        x: pts.reduce((s, q) => s + q.x, 0) / pts.length,
        y: pts.reduce((s, q) => s + q.y, 0) / pts.length,
      }
      g.textAlign = 'center'
      g.fillStyle = '#111827'
      g.font = '600 15px system-ui, sans-serif'
      g.fillText(p.label || 'Pen', mid.x, mid.y - 6)
      g.font = '12px system-ui, sans-serif'
      g.fillStyle = '#4b5563'
      g.fillText(`${Math.round(sqft).toLocaleString('en-CA')} ft² · ${cap.low}–${cap.high} head`, mid.x, mid.y + 11)
    }
  }

  // The kit.
  for (const it of items) {
    const cat = byId.get(it.catalog_id)
    if (!cat) continue
    const centre = at([it.lng, it.lat])
    if (isLinear(cat)) {
      const [a, b] = itemEnds([it.lng, it.lat], cat.width_ft, it.rotation).map(at)
      // A gate left standing open is drawn where its leaf actually is. The
      // hinge is the b end, and the swing turns clockwise about it — the same
      // sense as rotation, which is what this projection already draws in.
      const swung = cat.gate_type && cat.gate_type !== 'drive-over' ? it.swing_deg : 0
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const spans =
        !swung
          ? [[a, b]]
          : cat.gate_type === 'two-panel'
            ? [
                [turned(mid, b, swung), b],
                [turned(mid, a, -swung), a],
              ]
            : [[turned(a, b, swung), b]]
      g.strokeStyle = ink(cat.color)
      g.lineWidth = cat.panel_type === 'wind-fence' ? 5 : 3.5
      g.setLineDash(cat.gate_type === 'drive-over' ? [8, 5] : [])
      for (const [p1, p2] of spans) {
        g.beginPath()
        g.moveTo(p1.x, p1.y)
        g.lineTo(p2.x, p2.y)
        g.stroke()
      }
      g.setLineDash([])
      // End caps, so a run of panels shows where one stops and the next starts.
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      g.lineWidth = 2
      for (const [p1, p2] of spans) {
        const l = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
        const nx = (-(p2.y - p1.y) / l) * 4
        const ny = ((p2.x - p1.x) / l) * 4
        for (const e of [p1, p2]) {
          g.beginPath()
          g.moveTo(e.x - nx, e.y - ny)
          g.lineTo(e.x + nx, e.y + ny)
          g.stroke()
        }
      }
      // A gate is the one piece whose swing has to be on the plan: it is what
      // says the gate cannot open into the trough.
      if (cat.gate_type === 'swinging') {
        const r = cat.width_ft * scale
        g.strokeStyle = ink(cat.color) + '80'
        g.lineWidth = 1
        g.setLineDash([3, 3])
        g.beginPath()
        g.arc(a.x, a.y, r, 0, Math.PI * 2)
        g.stroke()
        g.setLineDash([])
      }
      if (len > 40) {
        g.save()
        g.translate((a.x + b.x) / 2, (a.y + b.y) / 2)
        let angle = Math.atan2(b.y - a.y, b.x - a.x)
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI
        g.rotate(angle)
        g.textAlign = 'center'
        g.font = '600 11px system-ui, sans-serif'
        g.fillStyle = '#1f2937'
        g.fillText(`${cat.width_ft}'`, 0, -6)
        g.restore()
      }
      continue
    }

    const w = cat.width_ft * scale
    const d = Math.max(cat.depth_ft * scale, 3)
    g.save()
    g.translate(centre.x, centre.y)
    g.rotate((it.rotation * Math.PI) / 180)
    g.strokeStyle = ink(cat.color)
    g.fillStyle = ink(cat.color) + '38'
    g.lineWidth = 1.5
    g.setLineDash(cat.category === 'Equipment' ? [6, 4] : [])
    if (cat.width_ft === cat.depth_ft || cat.animal_type) {
      g.beginPath()
      g.ellipse(0, 0, w / 2, d / 2, 0, 0, Math.PI * 2)
      g.fill()
      g.stroke()
    } else {
      g.fillRect(-w / 2, -d / 2, w, d)
      g.strokeRect(-w / 2, -d / 2, w, d)
    }
    g.setLineDash([])
    g.restore()
  }

  // A bar to measure the sheet against, and north.
  const bar = scaleBar(scale, 150)
  const bx = 46
  const by = PAPER.h - 40
  g.strokeStyle = '#111827'
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(bx, by)
  g.lineTo(bx + bar.px, by)
  g.moveTo(bx, by - 6)
  g.lineTo(bx, by + 6)
  g.moveTo(bx + bar.px, by - 6)
  g.lineTo(bx + bar.px, by + 6)
  g.stroke()
  g.textAlign = 'left'
  g.font = '600 13px system-ui, sans-serif'
  g.fillStyle = '#111827'
  g.fillText(`${bar.feet} ft`, bx, by - 12)

  const ax = PAPER.w - 52
  const ay = 60
  g.beginPath()
  g.moveTo(ax, ay + 20)
  g.lineTo(ax, ay - 18)
  g.stroke()
  g.beginPath()
  g.moveTo(ax, ay - 24)
  g.lineTo(ax - 6, ay - 12)
  g.lineTo(ax + 6, ay - 12)
  g.closePath()
  g.fillStyle = '#111827'
  g.fill()
  g.textAlign = 'center'
  g.fillText('N', ax, ay + 34)

  g.strokeStyle = '#d1d5db'
  g.lineWidth = 1
  g.strokeRect(8, 8, PAPER.w - 16, PAPER.h - 16)

  return { dataUrl: canvas.toDataURL('image/png'), width: PAPER.w, height: PAPER.h }
}

/* ── The tables ────────────────────────────────────────────────────────────── */

/** Feet of fence on the layout: panels, gates and wind fence end to end. */
export function fenceFeet(items: ItemRow[], catalog: CatalogRow[]): number {
  const byId = new Map(catalog.map((c) => [c.id, c]))
  return items.reduce((sum, i) => {
    const c = byId.get(i.catalog_id)
    return c && isLinear(c) && c.counted ? sum + c.width_ft : sum
  }, 0)
}

/**
 * The plan as a report: the facts, the parts and the pens.
 *
 * Pure, and separate from the drawing, so the numbers on the sheet can be
 * checked without a canvas to draw on.
 */
export function planReport(input: PlanInput, drawing?: Drawing | null): TableReport {
  const { items, paths, catalog, penHead, owned } = input
  const parts = partsList(items, catalog)
  const status = inventoryStatus(parts, owned, catalog).filter((s) => s.needed > 0 || s.owned > 0)
  const totalPieces = parts.reduce((s, p) => s + p.count, 0)
  const feet = fenceFeet(items, catalog)

  const partRows: Cell[][] = status.map((s) => {
    const cat = catalog.find((c) => c.id === s.item.id)
    return [
      s.item.category,
      s.item.name,
      cat ? `${cat.width_ft} ft` : '',
      s.needed,
      s.owned,
      s.short > 0 ? s.short : '',
    ]
  })

  const penRows: Cell[][] = paths
    .filter((p) => p.is_closed)
    .map((p) => {
      const sqft = areaFt2(p.points)
      const cap = penCapacity(sqft, p.usage_type)
      const head = penHead[p.id] ?? 0
      return [
        p.label || 'Pen',
        PEN_SPACE[p.usage_type].label,
        Math.round(sqft),
        `${cap.low}–${cap.high}`,
        head || '',
        head > 0 ? FIT_WORDS[penFit(head, cap)] : '',
        p.assigned_classes.join(', '),
      ]
    })

  return {
    title: `Handling plan — ${input.yardName}`,
    subtitle: input.layoutName,
    orientation: 'landscape',
    meta: [
      ['Yard', input.yardName],
      ['Ranch', input.ranchName ?? '—'],
      ['Layout', input.layoutName],
      ['Pieces on it', totalPieces],
      ['Fence', `${Math.round(feet).toLocaleString('en-CA')} ft`],
      ['Pens', penRows.length],
    ],
    image: drawing ?? undefined,
    lead: [
      'Drawn to scale from the satellite photo of the yard. Measure off the bar on the drawing, not off the paper.',
      'Pen capacity is a range because stock space is: the low figure allows room to lie down, the high is standing room.',
    ],
    sections: [
      {
        title: 'Parts',
        head: ['Category', 'Item', 'Size', 'Needed', 'You own', 'Short'],
        rows: partRows,
        foot: ['', 'Total', `${Math.round(feet).toLocaleString('en-CA')} ft of fence`, totalPieces, '', ''],
        empty: 'Nothing placed on this layout yet',
        note: 'Cattle and machinery are left out: they are placed to check clearance, not built.',
        align: ['left', 'left', 'right', 'right', 'right', 'right'],
      },
      {
        title: 'Pens',
        head: ['Pen', 'Used for', 'Area ft²', 'Holds', 'Head now', 'Fit', 'Classes'],
        rows: penRows,
        empty: 'No pens drawn on this layout',
        align: ['left', 'left', 'right', 'right', 'right', 'left', 'left'],
      },
    ],
  }
}

/** The whole plan, as a file. */
export async function downloadPlan(input: PlanInput): Promise<void> {
  const report = planReport(input, planDrawing(input))
  const name = `${input.yardName} ${input.layoutName}`.replace(/[\\/:*?"<>|]+/g, '-').trim()
  downloadBlob(await tableReportToPdf(report, input.now ? { now: input.now } : {}), `Handling plan — ${name}.pdf`)
}
