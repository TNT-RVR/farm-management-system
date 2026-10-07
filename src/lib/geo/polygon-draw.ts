import type { GeoJSONSource, Map as MLMap, MapMouseEvent } from 'maplibre-gl'
import type { FeatureCollection, MultiPolygon, Position } from 'geojson'
import { ringAreaM2 } from './area'

const SRC = 'crop-draw-src'
const FILL = 'crop-draw-fill'
const LINE = 'crop-draw-line'
const MIDS = 'crop-draw-mids'
const PTS = 'crop-draw-pts'

/** How close a click has to be to a handle, in screen pixels. */
const HIT_PX = 12

const M2_PER_ACRE = 4046.8564224

export type DrawState = {
  count: number
  acres: number
  /** Placing points, or adjusting a closed shape. */
  mode: 'draw' | 'edit'
  /** Which vertex is selected, so it can be deleted. */
  selected: number | null
  /** True once the ring is closed and the shape is real. */
  closed: boolean
}

/**
 * Click-to-place polygon drawing and editing for a MapLibre map.
 *
 * No external dependency, because the alternative is mapbox-gl-draw and half a
 * megabyte for a tool that has to be restyled anyway.
 *
 * Drawing: click to place corners; the area updates as you go, because "is that
 * patch about an acre" is the question being asked while drawing it and nobody
 * can answer it from a shape on a screen. Click the FIRST corner again to
 * close, which is how every mapping tool works and what people try first.
 *
 * Editing: drag a corner to move it, drag a hollow midpoint to add one there,
 * tap a corner to select it and delete it. A ring will not go below three
 * corners — below that it is not a shape and the delete simply refuses.
 */
export class PolygonDraw {
  private map: MLMap
  private verts: Position[] = []
  private cursor: Position | null = null
  private color: string
  private onChange?: (s: DrawState) => void

  private mode: 'draw' | 'edit' = 'draw'
  private closed = false
  private selected: number | null = null
  /** Index of the vertex being dragged, or null. */
  private dragging: number | null = null
  private moved = false

  constructor(map: MLMap, opts: { color?: string; onChange?: (s: DrawState) => void } = {}) {
    this.map = map
    this.color = opts.color ?? '#f59e0b'
    this.onChange = opts.onChange
  }

  private started = false

  start(existing?: Position[]) {
    // Adding a source or querying rendered features before the style has
    // finished loading throws "Style is not done loading", which reaches React
    // as a crashed view. Toggling a map layer restarts that load, so the window
    // is not just the first second after the page opens — it reopens every time
    // somebody turns a layer on and then draws.
    if (!this.map.isStyleLoaded()) {
      this.map.once('idle', () => {
        if (!this.destroyed) this.start(existing)
      })
      return
    }
    if (this.started) return
    this.started = true

    if (!this.map.getSource(SRC)) {
      this.map.addSource(SRC, { type: 'geojson', data: this.fc() })
      this.map.addLayer({
        id: FILL,
        type: 'fill',
        source: SRC,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': this.color, 'fill-opacity': 0.3 },
      })
      this.map.addLayer({
        id: LINE,
        type: 'line',
        source: SRC,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'line-color': this.color, 'line-width': 2 },
      })
      // Midpoints sit UNDER the corners, so a corner is always the thing you
      // grab where the two overlap on a short segment.
      this.map.addLayer({
        id: MIDS,
        type: 'circle',
        source: SRC,
        filter: ['==', ['get', 'kind'], 'mid'],
        paint: {
          'circle-radius': 4,
          'circle-color': '#fff',
          'circle-opacity': 0.7,
          'circle-stroke-color': this.color,
          'circle-stroke-width': 1,
        },
      })
      this.map.addLayer({
        id: PTS,
        type: 'circle',
        source: SRC,
        filter: ['==', ['get', 'kind'], 'vertex'],
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 7, 5],
          'circle-color': ['case', ['get', 'selected'], this.color, '#fff'],
          'circle-stroke-color': this.color,
          'circle-stroke-width': 2,
        },
      })
    }

    if (existing?.length) {
      // A ring arrives closed (last point repeats the first); the editor works
      // on the open list and closes it again on the way out.
      const ring = [...existing]
      if (ring.length > 1 && same(ring[0], ring[ring.length - 1])) ring.pop()
      this.verts = ring
      this.closed = true
      this.mode = 'edit'
    }

    this.map.getCanvas().style.cursor = 'crosshair'
    this.map.doubleClickZoom.disable()
    this.map.on('click', this.onClick)
    this.map.on('mousemove', this.onMove)
    this.map.on('mousedown', this.onDown)
    this.map.on('touchstart', this.onDown)
    this.render()
  }

  /** Which handle, if any, is under a screen point. */
  private hit(e: MapMouseEvent): { kind: 'vertex' | 'mid'; index: number } | null {
    // Same guard as start(): a hover arriving mid style-reload would throw.
    if (!this.map.isStyleLoaded() || !this.map.getLayer(PTS)) return null
    const feats = this.map.queryRenderedFeatures(
      [
        [e.point.x - HIT_PX, e.point.y - HIT_PX],
        [e.point.x + HIT_PX, e.point.y + HIT_PX],
      ],
      { layers: [PTS, MIDS] },
    )
    const f = feats[0]
    if (!f) return null
    const kind = f.properties?.kind as 'vertex' | 'mid' | undefined
    const index = Number(f.properties?.index)
    if (!kind || !Number.isFinite(index)) return null
    return { kind, index }
  }

  private onDown = (e: MapMouseEvent) => {
    if (!this.closed) return
    const h = this.hit(e)
    if (!h) return
    e.preventDefault()

    if (h.kind === 'mid') {
      // Dragging a midpoint turns it into a real corner at that spot, and the
      // drag continues on the new corner — one gesture to add and place.
      const at = h.index + 1
      this.verts.splice(at, 0, [e.lngLat.lng, e.lngLat.lat])
      this.dragging = at
      this.selected = at
    } else {
      this.dragging = h.index
      this.selected = h.index
    }
    this.moved = false
    this.map.dragPan.disable()
    this.map.on('mousemove', this.onDrag)
    this.map.on('touchmove', this.onDrag)
    this.map.once('mouseup', this.onUp)
    this.map.once('touchend', this.onUp)
    this.render()
    this.emit()
  }

  private onDrag = (e: MapMouseEvent) => {
    if (this.dragging == null) return
    this.moved = true
    this.verts[this.dragging] = [e.lngLat.lng, e.lngLat.lat]
    this.render()
    this.emit()
  }

  private onUp = () => {
    this.dragging = null
    this.map.dragPan.enable()
    this.map.off('mousemove', this.onDrag)
    this.map.off('touchmove', this.onDrag)
    this.render()
    this.emit()
  }

  private onClick = (e: MapMouseEvent) => {
    if (this.closed) {
      // A click that was really a drag must not change the selection out from
      // under the person who just finished moving a corner.
      if (this.moved) {
        this.moved = false
        return
      }
      const h = this.hit(e)
      this.selected = h?.kind === 'vertex' ? h.index : null
      this.render()
      this.emit()
      return
    }

    // Closing: clicking the first corner again finishes the shape, which is
    // what every other mapping tool does and the first thing anyone tries.
    if (this.verts.length >= 3) {
      const first = this.map.project(this.verts[0] as [number, number])
      const dx = first.x - e.point.x
      const dy = first.y - e.point.y
      if (Math.hypot(dx, dy) <= HIT_PX) {
        this.close()
        return
      }
    }

    this.verts.push([e.lngLat.lng, e.lngLat.lat])
    this.render()
    this.emit()
  }

  private onMove = (e: MapMouseEvent) => {
    if (this.closed) {
      // Show what is grabbable before it is grabbed.
      this.map.getCanvas().style.cursor = this.hit(e) ? 'move' : ''
      return
    }
    this.cursor = [e.lngLat.lng, e.lngLat.lat]
    if (this.verts.length) {
      this.render()
      // Emit as well as render. The rubber-band shape was redrawing while the
      // acreage beside it sat on whatever it was at the last click — so the
      // number only moved when a corner was placed, which is not what "the area
      // as you draw it" means and is exactly when somebody is watching it.
      this.emit()
    }
  }

  /** Close the ring and switch to editing. */
  close() {
    if (this.verts.length < 3) return
    this.closed = true
    this.mode = 'edit'
    this.cursor = null
    this.map.getCanvas().style.cursor = ''
    this.render()
    this.emit()
  }

  /** Remove the selected corner. Refuses to go below a triangle. */
  deleteSelected() {
    if (this.selected == null || this.verts.length <= 3) return
    this.verts.splice(this.selected, 1)
    this.selected = null
    this.render()
    this.emit()
  }

  undoLast() {
    if (this.closed) return
    this.verts.pop()
    this.render()
    this.emit()
  }

  get count() {
    return this.verts.length
  }

  get acres() {
    // Whatever is on screen: the closed ring, or the shape the cursor is
    // currently making. The question being asked is about what you can see.
    const ring = this.closed
      ? this.verts
      : [...this.verts, ...(this.cursor ? [this.cursor] : [])]
    if (ring.length < 3) return 0
    // ABSOLUTE. ringAreaM2 is signed — it returns a negative number for a ring
    // wound clockwise, which is simply the direction somebody happened to walk
    // around the shape. Unsigned, a clockwise draw showed no acreage at all
    // while drawing and then SAVED a negative one, which went on to read as a
    // field more than fully uncovered in the manure ranking.
    return Math.abs(ringAreaM2([...ring, ring[0]])) / M2_PER_ACRE
  }

  /** Closed ring as a MultiPolygon, or null if fewer than 3 corners. */
  finish(): MultiPolygon | null {
    if (this.verts.length < 3) return null
    const ring = [...this.verts, this.verts[0]]
    return { type: 'MultiPolygon', coordinates: [[ring]] }
  }

  cancel() {
    this.verts = []
    this.cursor = null
    this.closed = false
    this.mode = 'draw'
    this.selected = null
    this.render()
    this.emit()
  }

  private destroyed = false

  destroy() {
    this.destroyed = true
    this.map.off('click', this.onClick)
    this.map.off('mousemove', this.onMove)
    this.map.off('mousedown', this.onDown)
    this.map.off('touchstart', this.onDown)
    this.map.off('mousemove', this.onDrag)
    this.map.off('touchmove', this.onDrag)
    this.map.dragPan.enable()
    this.map.getCanvas().style.cursor = ''
    this.map.doubleClickZoom.enable()
    for (const id of [FILL, LINE, MIDS, PTS]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id)
    }
    if (this.map.getSource(SRC)) this.map.removeSource(SRC)
  }

  private emit() {
    this.onChange?.({
      count: this.verts.length,
      acres: this.acres,
      mode: this.mode,
      selected: this.selected,
      closed: this.closed,
    })
  }

  private fc(): FeatureCollection {
    const feats: FeatureCollection['features'] = []

    // Midpoints only once the shape is closed: while placing corners they
    // would be handles for a segment that is still moving.
    if (this.closed) {
      for (let i = 0; i < this.verts.length; i++) {
        const a = this.verts[i]
        const b = this.verts[(i + 1) % this.verts.length]
        feats.push({
          type: 'Feature',
          properties: { kind: 'mid', index: i },
          geometry: { type: 'Point', coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] },
        })
      }
    }

    this.verts.forEach((p, i) => {
      feats.push({
        type: 'Feature',
        properties: { kind: 'vertex', index: i, selected: this.selected === i },
        geometry: { type: 'Point', coordinates: p },
      })
    })

    const preview = this.closed
      ? this.verts
      : [...this.verts, ...(this.cursor ? [this.cursor] : [])]
    if (preview.length >= 3) {
      feats.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [[...preview, preview[0]]] },
      })
    }
    return { type: 'FeatureCollection', features: feats }
  }

  private render() {
    if (this.destroyed) return
    const src = this.map.getSource(SRC) as GeoJSONSource | undefined
    if (src) src.setData(this.fc())
  }
}

const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1]
