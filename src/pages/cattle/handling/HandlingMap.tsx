import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Position } from 'geojson'
import { kml as kmlToGeoJson } from '@tmcw/togeojson'
import { X } from 'lucide-react'
import type { MapMouseEvent } from 'maplibre-gl'
import { useFarmMap } from '@/lib/geo/use-farm-map'
import { formatDistance, haversineM, pathLengthM } from '@/lib/geo/measure'
import {
  NO_SELECTION,
  alignRotation,
  areaFt2,
  centroidPx,
  endSnap,
  framedBounds,
  isLinear,
  itemEnds,
  layoutBounds,
  marqueeHits,
  mergeSelected,
  nearestPoint,
  normBox,
  onlySelected,
  penCapacity,
  pxPerFoot,
  rotateAboutPx,
  selectionSize,
  selectionWords,
  snapAngle,
  toggleSelected,
  type Box,
  type EndTarget,
  type Selection,
  type UsageType,
} from '@/lib/handling'
import type { CatalogRow, ItemRow, LayerRow, PathRow, SiteRow, VersionRow } from '@/lib/handling-data'
import { ItemGlyph } from './shapes'

/**
 * The yard on the satellite photo, with the kit drawn on it to scale.
 *
 * Everything — equipment, pens, the measure line, uploaded KML — draws into ONE
 * SVG laid over the map and re-projected whenever the map moves. Map markers
 * were the obvious alternative and the wrong one: a marker keeps its pixel size
 * as you zoom, and the entire point of this tool is that a 10 ft panel stays 10
 * ft of ground.
 *
 * The overlay ignores pointer events except on the things you can grab, so a
 * click on bare photo still reaches the map and places, measures or draws.
 */

export type Tool = 'select' | 'place' | 'measure' | 'draw'
export type { Selection } from '@/lib/handling'

type Props = {
  site: SiteRow
  version: VersionRow
  catalog: CatalogRow[]
  items: ItemRow[]
  paths: PathRow[]
  layers: LayerRow[]
  /** Head worked out for each pen, for the label and the fit colour. */
  penHead: Record<string, number>
  showPens: boolean
  /** The right-hand map in split view: a picture, not a tool. */
  readOnly?: boolean
  tool: Tool
  setTool: (t: Tool) => void
  placing: string | null
  onPlaced: () => void
  selection: Selection
  onSelect: (s: Selection) => void
  /** Remembered so the next panel lands lined up with the last one. */
  lastRotation: number
  setLastRotation: (deg: number) => void
  edit: {
    addItem: (row: { catalog_id: string; lng: number; lat: number; rotation: number }) => void
    /**
     * Plural because a gesture is one thing that happened. Dragging six
     * selected panels has to come back in one press of undo, not six.
     */
    moveItems: (updates: { id: string; patch: { lng?: number; lat?: number; rotation?: number; swing_deg?: number } }[]) => void
    removeItems: (ids: string[]) => void
    addPath: (row: { points: [number, number][]; is_closed: boolean; usage_type?: UsageType }) => void
    updatePath: (id: string, patch: { points?: [number, number][] }) => void
    removePaths: (ids: string[]) => void
  }
  onSaveView?: (lng: number, lat: number, zoom: number) => void
  /** Ctrl+Z and Ctrl+Shift+Z: the keyboard lives here, the stack lives on the page. */
  onUndo?: () => void
  onRedo?: () => void
}

type Basemap = 'photo' | 'faded' | 'plain'
const BASEMAP_KEY = 'handling.basemap'
const BASEMAP_NEXT: Record<Basemap, Basemap> = { photo: 'faded', faded: 'plain', plain: 'photo' }
const BASEMAP_LABEL: Record<Basemap, string> = { photo: 'Photo', faded: 'Photo faded', plain: 'No photo' }

/**
 * A dark outline round everything drawn on the map.
 *
 * One filter on the group rather than a cased stroke per glyph: it is a single
 * pass over the layer, it costs nothing to maintain, and it works on shapes
 * that have no stroke at all.
 *
 * It runs on plain ground too, now that the kit is bright. It was photo-only
 * when the panels were slate and the gates were a dark green, because against
 * pale ground those were already the darker thing; a mint gate on pale ground
 * is the lighter one, and wants the same dark edge the photo gets.
 */
const HALO = 'drop-shadow(0 0 1.5px rgba(0,0,0,0.95)) drop-shadow(0 0 3px rgba(0,0,0,0.45))'

/**
 * "These two ends will join." Loud on purpose, and a colour no piece of kit
 * uses: it was green until the gates became green, and a highlight that says
 * *this is about to happen* must not be mistakable for the thing it is drawn
 * over.
 */
const JOIN = '#e879f9'

/** The grab point on the end of a gate leaf — drawn where the leaf is now. */
function SwingHandle({
  w,
  swing,
  twoPanel,
  onDown,
}: {
  w: number
  swing: number
  twoPanel: boolean
  onDown: (e: React.PointerEvent) => void
}) {
  const r = twoPanel ? w / 2 : w
  const t = (swing * Math.PI) / 180
  return (
    <circle
      cx={-w / 2 + r * Math.cos(t)}
      cy={r * Math.sin(t)}
      r={7}
      fill="#f59e0b"
      stroke="#fff"
      strokeWidth={2}
      className="pointer-events-auto cursor-grab"
      onPointerDown={onDown}
    />
  )
}

/**
 * The piece in hand, drawn where it would land.
 *
 * Where it WOULD land, not where the pointer is: if it has found the end of a
 * run it is already turned and already up against it, so the click holds no
 * surprise. The two ends that would meet are lit, and so is the whole panel
 * being joined — which end of which panel is the thing you cannot tell from a
 * ring round a point.
 */
function Ghosted({
  cat,
  ghost,
  pxPerFt,
  project,
  items,
  byId,
}: {
  cat: CatalogRow | null
  ghost: { at: Position; rotation: number; target: EndTarget | null }
  pxPerFt: number
  project: (p: Position) => { x: number; y: number }
  items: ItemRow[]
  byId: Map<string, CatalogRow>
}) {
  if (!cat) return null
  const s = project(ghost.at)
  const t = ghost.target
  const ends = itemEnds(ghost.at, cat.width_ft, ghost.rotation).map(project)
  const near = t
    ? ends.reduce((a, b) => (Math.hypot(a.x - t.x, a.y - t.y) <= Math.hypot(b.x - t.x, b.y - t.y) ? a : b))
    : null
  const joined = t ? items.find((i) => i.id === t.key.split(':')[0]) : null
  const joinedCat = joined ? byId.get(joined.catalog_id) : null
  const span =
    joined && joinedCat ? itemEnds([joined.lng, joined.lat], joinedCat.width_ft, joined.rotation).map(project) : null
  return (
    <g>
      {span && (
        <line
          x1={span[0].x}
          y1={span[0].y}
          x2={span[1].x}
          y2={span[1].y}
          stroke={JOIN}
          strokeWidth={6}
          strokeOpacity={0.5}
          strokeLinecap="round"
        />
      )}
      <g transform={`translate(${s.x} ${s.y}) rotate(${ghost.rotation})`} opacity={t ? 0.95 : 0.6}>
        <ItemGlyph item={cat} pxPerFt={pxPerFt} rotation={ghost.rotation} />
      </g>
      {t && near && (
        <>
          <circle cx={t.x} cy={t.y} r={9} fill="none" stroke={JOIN} strokeWidth={3} />
          <circle cx={near.x} cy={near.y} r={5.5} fill={JOIN} stroke="#fff" strokeWidth={2} />
        </>
      )}
    </g>
  )
}

const FIT_COLOR: Record<string, string> = {
  empty: '#facc15',
  fits: '#4ade80',
  marginal: '#fb923c',
  over: '#f87171',
}

export function HandlingMap({
  site,
  version,
  catalog,
  items,
  paths,
  layers,
  penHead,
  showPens,
  readOnly,
  tool,
  setTool,
  placing,
  onPlaced,
  selection,
  onSelect,
  lastRotation,
  setLastRotation,
  edit,
  onSaveView,
  onUndo,
  onRedo,
}: Props) {
  const box = useRef<HTMLDivElement | null>(null)
  const svg = useRef<SVGSVGElement | null>(null)
  const { map, ready } = useFarmMap(
    box,
    {
      center: site.center_lng != null && site.center_lat != null ? [site.center_lng, site.center_lat] : undefined,
      zoom: site.zoom ?? 18,
      // Zoom goes bottom-right. The default is top-right, which is where the
      // parts counter sits (panels.tsx: absolute right-3 top-3), so the + and −
      // landed on top of it and hid the count against each line of kit -- the
      // one number that card exists to show. Top-left is the layers button and
      // bottom-left is the scale bar, so bottom-right is the free corner; the
      // pills along the bottom are centred and translate out of the way.
      controls: { nav: { showCompass: false }, navAt: 'bottom-right', scale: true },
      attribution: 'compact',
      interactive: !readOnly,
      readyWhen: 'style',
    },
    [],
  )

  // Re-project on every frame the map moves. MapLibre fires 'move' throughout a
  // drag, which is exactly the cadence the overlay needs. `frame` has to be
  // read and not discarded: it is what the memos below hang off, and without it
  // the scale is worked out once and every panel is the wrong length after the
  // first zoom.
  const [frame, redraw] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!map) return
    const on = () => redraw()
    map.on('move', on)
    map.on('zoom', on)
    map.on('resize', on)
    return () => {
      map.off('move', on)
      map.off('zoom', on)
      map.off('resize', on)
    }
  }, [map])

  // Where the map was left, per yard.
  useEffect(() => {
    if (!map || readOnly || !onSaveView) return
    const on = () => {
      const c = map.getCenter()
      onSaveView(c.lng, c.lat, map.getZoom())
    }
    map.on('moveend', on)
    return () => void map.off('moveend', on)
  }, [map, readOnly, onSaveView])

  const byId = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog])

  // ── Framing ───────────────────────────────────────────────────────────────
  // Fit to what is on the layout, one animation frame after the map is ready so
  // the container has been measured. Fitting a zero-sized container throws, and
  // that is how the prototype learnt this.
  const framed = useRef<string | null>(null)
  useEffect(() => {
    if (!map || !ready) return
    const key = version.id
    if (framed.current === key) return
    framed.current = key
    const bounds = framedBounds(layoutBounds(items, paths))
    const frame = () => {
      if (bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 20, duration: 0 })
      else if (site.center_lng != null && site.center_lat != null)
        map.jumpTo({ center: [site.center_lng, site.center_lat], zoom: site.zoom ?? 18 })
    }
    const id = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(id)
    // Framing is for opening a layout, not for every edit to one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ready, version.id])

  const project = useCallback(
    (p: Position) => {
      const q = map!.project(p as [number, number])
      return { x: q.x, y: q.y }
    },
    [map],
  )

  const pxPerFt = useMemo(() => {
    if (!map || !ready) return 0
    const c = map.getCenter()
    return pxPerFoot(project, [c.lng, c.lat])
    // Recomputed on every frame: the zoom is what changes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ready, project, frame])

  // ── The gesture in progress ───────────────────────────────────────────────
  /**
   * Where the thing being dragged is right now.
   *
   * It lives in a ref and is mirrored into state for drawing. Both are written
   * from the pointer handlers, which are the only place that moves anything —
   * they are registered once and would otherwise close over a stale copy.
   *
   * It is dropped as the gesture ends (see settleGesture below) rather than
   * held until the saved row catches up: the mutation writes the new position
   * straight into the query cache, so there is no gap left to cover and no
   * "has it landed yet" question to get wrong.
   */
  type Draft = Record<string, { lng?: number; lat?: number; rotation?: number; swing_deg?: number }>
  type VertexDraft = { pathId: string; index: number; at: Position; inserting: boolean } | null
  const gesture = useRef<{ draft: Draft; vertex: VertexDraft }>({ draft: {}, vertex: null })
  const [draft, setDraft] = useState<Draft>({})
  const [vertexDraft, setVertexDraft] = useState<VertexDraft>(null)
  const showGesture = useCallback(() => {
    setDraft({ ...gesture.current.draft })
    setVertexDraft(gesture.current.vertex)
  }, [])
  const endGesture = useCallback(() => {
    gesture.current = { draft: {}, vertex: null }
    showGesture()
  }, [showGesture])
  /**
   * End a gesture that has just been handed to a mutation.
   *
   * A frame later, not now: the mutation writes the new position into the
   * query cache from `onMutate`, which react-query runs a microtask after
   * `mutate()` returns. Dropping the draft in the same breath would show one
   * frame of the panel back where it started — a flinch on every single drag.
   */
  const settleGesture = useCallback(() => {
    requestAnimationFrame(endGesture)
  }, [endGesture])

  const shown = useMemo(() => items.map((i) => ({ ...i, ...draft[i.id] })), [items, draft])

  // ── What is under the kit ─────────────────────────────────────────────────
  /**
   * The photo, faded, or nothing at all.
   *
   * A corral is grey steel on brown dirt, and at the zoom you lay panels at
   * the photo wins: a 12 ft gate on bare ground is a green hairline nobody can
   * see. Turning the photo down, or off, is the difference between siting the
   * yard (where the photo IS the information) and laying it out (where it is
   * noise). Kept across visits because it is a working preference, not a view.
   */
  const [basemap, setBasemap] = useState<Basemap>(() => {
    try {
      const saved = localStorage.getItem(BASEMAP_KEY)
      return saved === 'faded' || saved === 'plain' ? saved : 'photo'
    } catch {
      return 'photo'
    }
  })
  useEffect(() => {
    if (!map || !ready || !map.getLayer('esri')) return
    map.setPaintProperty('esri', 'raster-opacity', basemap === 'photo' ? 1 : basemap === 'faded' ? 0.35 : 0)
    try {
      localStorage.setItem(BASEMAP_KEY, basemap)
    } catch {
      // A browser with storage turned off still gets the map; it just forgets.
    }
  }, [map, ready, basemap])

  // ── Tool state that is never saved ────────────────────────────────────────
  const [measure, setMeasure] = useState<Position[]>([])
  const [metric, setMetric] = useState(false)
  const [cursor, setCursor] = useState<Position | null>(null)
  const [snap, setSnap] = useState<{ x: number; y: number } | null>(null)
  // Corners clicked so far. Held in a ref for the same reason as the drag
  // above — the map's click handler is registered once — and mirrored into
  // state so the dashed line redraws.
  const drawingRef = useRef<Position[]>([])
  const [drawing, setDrawing] = useState<Position[]>([])
  const setCorners = useCallback((pts: Position[]) => {
    drawingRef.current = pts
    setDrawing(pts)
  }, [])

  // Double-click zoom fights closing a pen, and space-to-pan wants the keyboard.
  useEffect(() => {
    if (!map || readOnly) return
    if (tool === 'draw') map.doubleClickZoom.disable()
    else map.doubleClickZoom.enable()
  }, [map, tool, readOnly])

  /** Every vertex already on the layout, in screen pixels, for snapping. */
  const snapTargets = useMemo(() => {
    if (!map || !ready) return []
    const out: { x: number; y: number; key: string; lngLat: Position }[] = []
    for (const p of paths)
      p.points.forEach((pt, i) => {
        const s = project(pt)
        out.push({ ...s, key: `${p.id}:${i}`, lngLat: pt })
      })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ready, paths, project, frame])

  /** The clicked point, pulled onto a nearby vertex if there is one. */
  const withSnap = useCallback(
    (p: Position): Position => {
      if (!map) return p
      const at = project(p)
      const hit = nearestPoint(at, snapTargets)
      if (!hit) return p
      return snapTargets.find((t) => t.key === hit.key)?.lngLat ?? p
    },
    [map, project, snapTargets],
  )

  // ── What is picked ────────────────────────────────────────────────────────
  const isItemSel = useCallback((id: string) => selection.items.includes(id), [selection])
  const isPathSel = useCallback((id: string) => selection.paths.includes(id), [selection])

  /**
   * How a click changes the selection.
   *
   * Shift or Ctrl adds and takes away. A plain click on something already in
   * a group of several LEAVES the group alone, which is what makes dragging a
   * group work at all: the pointer goes down on one panel of six and the other
   * five have to still be picked when it starts to move.
   */
  const clicked = useCallback(
    (kind: 'item' | 'path', id: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        onSelect(toggleSelected(selection, kind, id))
        return
      }
      const already = kind === 'item' ? isItemSel(id) : isPathSel(id)
      if (already && selectionSize(selection) > 1) return
      onSelect(onlySelected(kind, id))
    },
    [selection, onSelect, isItemSel, isPathSel],
  )

  /**
   * The ends of every run of fence except the ones being dragged.
   *
   * What a panel snaps to. Only linear pieces have ends worth joining — a
   * trough has a footprint, not two ends — and a piece never snaps to itself
   * or to the others moving with it, or a group drag would fold in on itself.
   */
  const endTargets = useMemo((): EndTarget[] => {
    // Place as well as Select: a panel being laid lands on the end of the last
    // one just as a panel being dragged does.
    if (!map || !ready || (tool !== 'select' && tool !== 'place')) return []
    const out: EndTarget[] = []
    for (const it of items) {
      if (selection.items.includes(it.id)) continue
      const cat = byId.get(it.catalog_id)
      if (!cat || !isLinear(cat)) continue
      itemEnds([it.lng, it.lat], cat.width_ft, it.rotation).forEach((end, i) => {
        const s = project(end)
        out.push({ x: s.x, y: s.y, key: `${it.id}:${i}`, rotation: it.rotation })
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ready, tool, items, selection, byId, project, frame])

  // ── The piece about to be dropped ─────────────────────────────────────────
  /**
   * What you are holding, drawn under the cursor before you let go of it.
   *
   * Worked out exactly the way a dragged panel is, so that what is on screen
   * before the click is what lands on the click — including the snap. If one
   * of its ends comes within reach of the end of another run, the ghost turns
   * to match and jumps onto it, and `target` names the end it would join so
   * both can be lit up.
   */
  type Ghost = { at: Position; rotation: number; target: EndTarget | null; raw: Position }
  /**
   * Kept beside the catalog id it belongs to, and read as "the ghost if it is
   * the thing in hand, otherwise none". That needs no effect to clear it when
   * the tool changes or a different piece is picked — and an effect is the
   * wrong tool anyway, because a stale ghost is not just a stale drawing: it
   * is where the next click would put a panel.
   */
  const ghost = useRef<{ key: string; g: Ghost } | null>(null)
  const [ghostState, setGhostState] = useState<{ key: string; g: Ghost } | null>(null)
  const held = tool === 'place' && placing ? placing : ''
  const ghostShown = ghostState && ghostState.key === held && held ? ghostState.g : null
  const setGhost = useCallback((key: string, g: Ghost) => {
    ghost.current = { key, g }
    setGhostState({ key, g })
  }, [])

  const ghostAt = useCallback(
    (at: Position, rotation: number): Ghost => {
      const cat = placing ? byId.get(placing) : null
      if (!map || !cat || !isLinear(cat)) return { at, rotation, target: null, raw: at }
      const hit = endSnap(itemEnds(at, cat.width_ft, rotation).map(project), endTargets)
      if (!hit) return { at, rotation, target: null, raw: at }
      // Turned to match first, then shifted, because turning moves the ends.
      const lined = alignRotation(rotation, hit.target.rotation)
      const after = endSnap(itemEnds(at, cat.width_ft, lined).map(project), endTargets) ?? hit
      const c = project(at)
      const to = map.unproject([c.x + after.dx, c.y + after.dy])
      return { at: [to.lng, to.lat], rotation: lined, target: after.target, raw: at }
    },
    [map, placing, byId, project, endTargets],
  )

  // Shift-drag is MapLibre's box zoom, and it is the box SELECT here: a yard
  // is laid out in runs and dragging a box round one is how you pick a run.
  // Zooming to a box is no loss — the wheel and the buttons both do it.
  useEffect(() => {
    if (!map || readOnly) return
    if (tool === 'select') map.boxZoom.disable()
    else map.boxZoom.enable()
  }, [map, tool, readOnly])

  // ── Map clicks ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map || readOnly) return
    const onClick = (e: MapMouseEvent) => {
      // A click that landed on a panel belongs to the overlay, not the map.
      //
      // MapLibre listens on its CONTAINER, and the overlay is a child of that
      // container, so a click on a panel reaches both: the panel selects it and
      // the map, a moment later, clears the selection. pointer-events on the
      // SVG controls hit-testing, not bubbling, so it has to be said here.
      if (svg.current?.contains(e.originalEvent.target as Node)) return
      const at: Position = [e.lngLat.lng, e.lngLat.lat]
      if (tool === 'place' && placing) {
        // Where the ghost is, not where the pointer is: if it snapped onto the
        // end of a run, that is the join you were looking at when you clicked.
        const g =
          ghost.current?.key === placing ? ghost.current.g : { at, rotation: lastRotation, target: null, raw: at }
        edit.addItem({ catalog_id: placing, lng: g.at[0], lat: g.at[1], rotation: g.rotation })
        if (g.rotation !== lastRotation) setLastRotation(g.rotation)
        onPlaced()
        return
      }
      if (tool === 'measure') {
        setMeasure((m) => (m.length >= 2 ? [at] : [...m, at]))
        return
      }
      if (tool === 'draw') {
        setCorners([...drawingRef.current, withSnap(at)])
        return
      }
      // A box drag ends in a click on the photo; clearing here would throw
      // away what the box just picked.
      if (marquee.current) return
      onSelect(NO_SELECTION)
    }
    const onDbl = () => {
      if (tool !== 'draw') return
      const pts = drawingRef.current
      // The second click of the double-click has already landed as a point.
      const trimmed =
        pts.length >= 2 && haversineM(pts[pts.length - 1], pts[pts.length - 2]) < 0.5 ? pts.slice(0, -1) : pts
      if (trimmed.length >= 3) edit.addPath({ points: trimmed as [number, number][], is_closed: true })
      setCorners([])
    }
    const onMove = (e: MapMouseEvent) => {
      if (tool === 'place') {
        if (placing) setGhost(placing, ghostAt([e.lngLat.lng, e.lngLat.lat], lastRotation))
        return
      }
      // Only the two tools that draw a line to the cursor follow it. Setting
      // state on every mouse move in Select mode would re-render the whole
      // overlay for nothing.
      if (tool !== 'draw' && tool !== 'measure') return
      const at: Position = [e.lngLat.lng, e.lngLat.lat]
      setCursor(at)
      if (tool !== 'draw') {
        setSnap(null)
        return
      }
      const hit = nearestPoint(project(at), snapTargets)
      setSnap(hit ? { x: hit.x, y: hit.y } : null)
    }
    map.on('click', onClick)
    map.on('dblclick', onDbl)
    map.on('mousemove', onMove)
    return () => {
      map.off('click', onClick)
      map.off('dblclick', onDbl)
      map.off('mousemove', onMove)
    }
  }, [
    map,
    readOnly,
    tool,
    placing,
    lastRotation,
    edit,
    onPlaced,
    onSelect,
    withSnap,
    project,
    snapTargets,
    setCorners,
    ghostAt,
    setGhost,
    setLastRotation,
  ])

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (readOnly) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const k = e.key.toLowerCase()
      // Undo first: Ctrl+Z must not also be read as a tool shortcut.
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) onRedo?.()
        else onUndo?.()
        return
      }
      if ((e.ctrlKey || e.metaKey) && k === 'y') {
        e.preventDefault()
        onRedo?.()
        return
      }
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+A is below; every other Ctrl chord belongs to the browser.
        if (k !== 'a') return
      }
      if (k === 's') setTool('select')
      else if (k === 'p') setTool('place')
      else if (k === 'm') {
        setMeasure([])
        setTool('measure')
      } else if (k === 'd') setTool('draw')
      else if (e.key === 'Escape') {
        setCorners([])
        onSelect(NO_SELECTION)
      } else if (e.key === 'Enter' && drawingRef.current.length >= 2) {
        edit.addPath({ points: drawingRef.current as [number, number][], is_closed: false })
        setCorners([])
      } else if (k === 'a' && (e.ctrlKey || e.metaKey)) {
        // Everything, so a whole yard can be shifted or turned at once.
        e.preventDefault()
        onSelect({ items: items.map((i) => i.id), paths: paths.map((p) => p.id) })
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectionSize(selection) > 0) {
        if (selection.items.length) edit.removeItems(selection.items)
        if (selection.paths.length) edit.removePaths(selection.paths)
        onSelect(NO_SELECTION)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [readOnly, setTool, selection, edit, onSelect, setCorners, items, paths, onUndo, onRedo])

  // Space to pan: MapLibre pans on drag already, so this only has to keep the
  // page from scrolling while the key is held.
  useEffect(() => {
    if (readOnly) return
    const stop = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest?.('input,textarea')) e.preventDefault()
    }
    window.addEventListener('keydown', stop)
    return () => window.removeEventListener('keydown', stop)
  }, [readOnly])

  // ── Scroll to rotate what you are holding ─────────────────────────────────
  // On the CONTAINER, in the capture phase, because the ghost is not a pointer
  // target: a wheel over it goes straight through to the map, and MapLibre's
  // own listener sits on a child of this element. Ctrl and Cmd are left alone
  // so the wheel can still zoom with a panel in hand.
  useEffect(() => {
    const el = box.current
    if (!el || readOnly || tool !== 'place' || !placing) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return
      e.preventDefault()
      e.stopPropagation()
      const step = (e.deltaY > 0 ? 1 : -1) * (e.shiftKey ? 1 : 5)
      const next = snapAngle(lastRotation + step, e.shiftKey)
      setLastRotation(next)
      // From the cursor's own point, never from where the last snap put it:
      // re-snapping a snapped position walks the panel down the fence.
      const g = ghost.current?.key === placing ? ghost.current.g : null
      if (g) setGhost(placing, ghostAt(g.raw, next))
    }
    el.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => el.removeEventListener('wheel', onWheel, { capture: true })
  }, [readOnly, tool, placing, lastRotation, ghostAt, setGhost, setLastRotation])

  // ── Scroll to rotate ──────────────────────────────────────────────────────
  // One non-passive listener on the SVG rather than one per item. A React
  // onWheel cannot do this: it is registered passive, so preventDefault is
  // ignored and the map zooms out from under the panel being turned.
  const rotateTimer = useRef<number | null>(null)
  const pendingRot = useRef<Record<string, number>>({})
  useEffect(() => {
    const el = svg.current
    if (!el || readOnly) return
    const onWheel = (e: WheelEvent) => {
      const g = (e.target as Element)?.closest?.('[data-item-id]')
      if (!g) return
      e.preventDefault()
      e.stopPropagation()
      const id = g.getAttribute('data-item-id')!
      // Over one of several picked pieces, the wheel turns all of them, each
      // about its own middle: squaring up a run of fence that went in crooked.
      const turning = isItemSel(id) && selection.items.length > 1 ? selection.items : [id]
      const step = (e.deltaY > 0 ? 1 : -1) * (e.shiftKey ? 1 : 5)
      let last = 0
      for (const target of turning) {
        const current = pendingRot.current[target] ?? shown.find((i) => i.id === target)?.rotation ?? 0
        const next = snapAngle(current + step, e.shiftKey)
        pendingRot.current[target] = next
        gesture.current.draft[target] = { ...gesture.current.draft[target], rotation: next }
        last = next
      }
      showGesture()
      setLastRotation(last)
      // One write for a flick of the wheel rather than forty.
      if (rotateTimer.current) window.clearTimeout(rotateTimer.current)
      rotateTimer.current = window.setTimeout(() => {
        const updates = Object.entries(pendingRot.current).map(([itemId, rotation]) => ({
          id: itemId,
          patch: { rotation },
        }))
        if (updates.length) edit.moveItems(updates)
        pendingRot.current = {}
        settleGesture()
      }, 250)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [readOnly, shown, edit, setLastRotation, showGesture, settleGesture, isItemSel, selection])

  // ── Dragging ──────────────────────────────────────────────────────────────
  /**
   * What is being moved, and where it all started.
   *
   * A group gesture keeps the ORIGINAL position of everything it touches and
   * works out each frame from that, rather than nudging what it did last
   * frame. Accumulating is how a group of panels drifts apart over a long
   * drag: every frame's rounding is kept and multiplied.
   */
  type Origin = Record<string, { lng: number; lat: number; rotation: number }>
  type Drag =
    | { kind: 'item'; id: string; from: Position; origin: Origin }
    | { kind: 'rotate'; id: string }
    | { kind: 'swing'; id: string }
    | { kind: 'spin'; centre: Position; startDeg: number; origin: Origin }
    | { kind: 'vertex'; pathId: string; index: number }
    | { kind: 'midpoint'; pathId: string; index: number }
  const drag = useRef<Drag | null>(null)
  /** The box being dragged round a run of fence, in screen pixels. */
  const marquee = useRef<Box | null>(null)
  const [marqueeBox, setMarqueeBox] = useState<Box | null>(null)

  const toLngLat = useCallback(
    (e: PointerEvent | React.PointerEvent): Position | null => {
      const rect = box.current?.getBoundingClientRect()
      if (!rect || !map) return null
      const p = map.unproject([e.clientX - rect.left, e.clientY - rect.top])
      return [p.lng, p.lat]
    },
    [map],
  )

  /** Everything picked, as it stands right now, for a group gesture to work from. */
  const originOf = useCallback(
    (ids: string[]): Origin => {
      const out: Origin = {}
      for (const id of ids) {
        const it = shown.find((i) => i.id === id)
        if (it) out[id] = { lng: it.lng, lat: it.lat, rotation: it.rotation }
      }
      return out
    },
    [shown],
  )

  const startDrag = (d: Drag) => (e: React.PointerEvent) => {
    if (readOnly) return
    e.stopPropagation()
    drag.current = d
    map?.dragPan.disable()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  useEffect(() => {
    if (!map || readOnly) return
    const onMove = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const at = toLngLat(e)
      if (!at) return
      if (d.kind === 'item') {
        // The shift the pointer has made, in pixels, applied to where
        // everything started. One piece or twenty, it is the same sum.
        const a = project(d.from)
        const b = project(at)
        const dx = b.x - a.x
        const dy = b.y - a.y
        const ids = Object.keys(d.origin)
        for (const id of ids) {
          const o = d.origin[id]
          const p = project([o.lng, o.lat])
          const moved = map.unproject([p.x + dx, p.y + dy])
          gesture.current.draft[id] = { ...gesture.current.draft[id], lng: moved.lng, lat: moved.lat }
        }

        // End to end: one run of fence being laid against another.
        //
        // Only for a single piece. Snapping a group would mean deciding which
        // of its ends is the one that matters, and the answer is never the
        // same twice.
        let ring: { x: number; y: number } | null = null
        if (ids.length === 1) {
          const cat = byId.get(shown.find((i) => i.id === ids[0])?.catalog_id ?? '')
          const dr = gesture.current.draft[ids[0]]
          if (cat && isLinear(cat) && dr?.lng != null && dr.lat != null) {
            const centre: Position = [dr.lng, dr.lat]
            const rotation = dr.rotation ?? d.origin[ids[0]].rotation
            const ends = itemEnds(centre, cat.width_ft, rotation).map(project)
            const hit = endSnap(ends, endTargets)
            if (hit) {
              const lined = alignRotation(rotation, hit.target.rotation)
              // Turned to match first, then shifted, because turning moves
              // the ends: snapping on the old angle would leave a gap the
              // width of the turn.
              const spun = itemEnds(centre, cat.width_ft, lined).map(project)
              const after = endSnap(spun, endTargets) ?? hit
              const c = project(centre)
              const to = map.unproject([c.x + after.dx, c.y + after.dy])
              gesture.current.draft[ids[0]] = { lng: to.lng, lat: to.lat, rotation: lined }
              ring = { x: after.target.x, y: after.target.y }
            }
          }
        }
        setSnap(ring)
        showGesture()
      } else if (d.kind === 'spin') {
        // A group turns about its own middle: a tub and its alley swing round
        // together instead of each piece spinning where it stands.
        const c = project(d.centre)
        const p = project(at)
        const now = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI
        const delta = snapAngle(now - d.startDeg, e.shiftKey)
        for (const [id, o] of Object.entries(d.origin)) {
          const was = project([o.lng, o.lat])
          const spun = rotateAboutPx(was, c, delta)
          const moved = map.unproject([spun.x, spun.y])
          gesture.current.draft[id] = {
            lng: moved.lng,
            lat: moved.lat,
            rotation: snapAngle(o.rotation + delta, e.shiftKey),
          }
        }
        showGesture()
      } else if (d.kind === 'rotate') {
        const it = shown.find((i) => i.id === d.id)
        if (!it) return
        const c = project([it.lng, it.lat])
        const p = project(at)
        // The handle sits straight up from the item and does not turn with it,
        // so straight up has to mean the rotation it already has: atan2 reads 0
        // along +x, hence the +90. Without it, grabbing the handle and not
        // moving snaps the panel a quarter turn.
        const deg = snapAngle((Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90, e.shiftKey)
        gesture.current.draft[d.id] = { ...gesture.current.draft[d.id], rotation: deg }
        showGesture()
      } else if (d.kind === 'swing') {
        const it = shown.find((i) => i.id === d.id)
        const cat = it && byId.get(it.catalog_id)
        if (!it || !cat) return
        // About the hinge, which is the end the leaf is hung on, and measured
        // off the gate's own shut line so that 0 is shut whichever way round
        // the gate was laid.
        const hinge = project(itemEnds([it.lng, it.lat], cat.width_ft, it.rotation)[1])
        const p = project(at)
        const off = (Math.atan2(p.y - hinge.y, p.x - hinge.x) * 180) / Math.PI - it.rotation
        const swing = snapAngle(((((off % 360) + 540) % 360) - 180), e.shiftKey)
        gesture.current.draft[d.id] = { ...gesture.current.draft[d.id], swing_deg: swing }
        showGesture()
      } else if (d.kind === 'vertex' || d.kind === 'midpoint') {
        gesture.current.vertex = { pathId: d.pathId, index: d.index, at, inserting: d.kind === 'midpoint' }
        showGesture()
      }
    }
    const onUp = () => {
      const d = drag.current
      drag.current = null
      map.dragPan.enable()
      if (!d) return
      if (d.kind === 'item' || d.kind === 'spin') {
        const updates = Object.keys(d.origin)
          .map((id) => ({ id, patch: gesture.current.draft[id] }))
          .filter((u) => u.patch?.lng != null && u.patch?.lat != null)
        if (updates.length) edit.moveItems(updates)
        const turned = updates[updates.length - 1]?.patch?.rotation
        if (turned != null) setLastRotation(turned)
        setSnap(null)
      } else if (d.kind === 'rotate') {
        const rot = gesture.current.draft[d.id]?.rotation
        if (rot != null) {
          edit.moveItems([{ id: d.id, patch: { rotation: rot } }])
          setLastRotation(rot)
        }
      } else if (d.kind === 'swing') {
        const sw = gesture.current.draft[d.id]?.swing_deg
        if (sw != null) edit.moveItems([{ id: d.id, patch: { swing_deg: sw } }])
      } else {
        const v = gesture.current.vertex
        const path = v && paths.find((p) => p.id === v.pathId)
        if (v && path) {
          const pts = [...path.points]
          if (v.inserting) pts.splice(v.index + 1, 0, v.at as [number, number])
          else pts[v.index] = v.at as [number, number]
          edit.updatePath(v.pathId, { points: pts })
        }
      }
      settleGesture()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [
    map,
    readOnly,
    shown,
    paths,
    project,
    toLngLat,
    edit,
    setLastRotation,
    showGesture,
    settleGesture,
    byId,
    endTargets,
  ])

  // ── The box drag ──────────────────────────────────────────────────────────
  /**
   * Shift and drag across the yard to pick everything in the box.
   *
   * Listened for on the container rather than through MapLibre, because what
   * is wanted is the raw pixels the pointer moved through and MapLibre's own
   * box handler has been turned off above. Holding Shift also means a plain
   * drag still pans the map, which is how anybody gets round a yard.
   */
  useEffect(() => {
    const el = box.current
    if (!el || !map || readOnly || tool !== 'select') return
    const corner = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onDown = (e: PointerEvent) => {
      if (!e.shiftKey || e.button !== 0) return
      if (svg.current?.contains(e.target as Node)) return
      const p = corner(e)
      marquee.current = { x1: p.x, y1: p.y, x2: p.x, y2: p.y }
      setMarqueeBox(marquee.current)
      map.dragPan.disable()
    }
    const onMove = (e: PointerEvent) => {
      if (!marquee.current) return
      const p = corner(e)
      marquee.current = { ...marquee.current, x2: p.x, y2: p.y }
      setMarqueeBox(marquee.current)
    }
    const onUp = () => {
      const b = marquee.current
      if (!b) return
      map.dragPan.enable()
      setMarqueeBox(null)
      const box2 = normBox(b)
      // A box a few pixels across is a shift-click that wobbled, not a box.
      const tiny = box2.x2 - box2.x1 < 5 && box2.y2 - box2.y1 < 5
      if (!tiny) {
        const hits = marqueeHits(
          box2,
          shown.map((i) => ({ id: i.id, ...project([i.lng, i.lat]) })),
          paths.map((p) => ({ id: p.id, pts: p.points.map(project) })),
        )
        // Added to what was picked, because Shift is the add key everywhere.
        onSelect(mergeSelected(selection, hits))
      }
      // Cleared a frame later: the map's own click lands after this, and it
      // is the flag that tells it not to clear the selection.
      requestAnimationFrame(() => {
        marquee.current = null
      })
    }
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [map, readOnly, tool, shown, paths, project, selection, onSelect])

  /** A path's points with the vertex being dragged moved, or inserted. */
  const pointsOf = useCallback(
    (p: PathRow): Position[] => {
      const v = vertexDraft
      if (!v || v.pathId !== p.id) return p.points
      const pts = [...p.points]
      if (v.inserting) pts.splice(v.index + 1, 0, v.at as [number, number])
      else pts[v.index] = v.at as [number, number]
      return pts
    },
    [vertexDraft],
  )

  // ── Uploaded KML ──────────────────────────────────────────────────────────
  const kmlShapes = useMemo(() => {
    const out: { color: string; rings: Position[][]; points: Position[] }[] = []
    for (const layer of layers) {
      if (!layer.visible) continue
      try {
        const doc = new DOMParser().parseFromString(layer.kml_content, 'application/xml')
        const gj = kmlToGeoJson(doc)
        const rings: Position[][] = []
        const pts: Position[] = []
        for (const f of gj.features) {
          const g = f.geometry
          if (!g) continue
          if (g.type === 'LineString') rings.push(g.coordinates as Position[])
          else if (g.type === 'MultiLineString') rings.push(...(g.coordinates as Position[][]))
          else if (g.type === 'Polygon') rings.push(...(g.coordinates as Position[][]))
          else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) rings.push(...(poly as Position[][]))
          else if (g.type === 'Point') pts.push(g.coordinates as Position)
        }
        out.push({ color: layer.color, rings, points: pts })
      } catch {
        // A KML the browser cannot parse draws nothing rather than taking the
        // page down. The file is still on the Layers tab to be replaced.
      }
    }
    return out
  }, [layers])

  const d = (pts: Position[], close = false) => {
    if (!pts.length) return ''
    const s = pts.map((p, i) => `${i ? 'L' : 'M'} ${project(p).x} ${project(p).y}`).join(' ')
    return close ? `${s} Z` : s
  }

  /**
   * The middle and the extent of a group of pieces, in screen pixels.
   *
   * One box and one set of handles for the whole group: a rotate handle on
   * each of twelve selected panels is twelve handles, and none of them would
   * do what the eye expects, which is to swing the lot.
   */
  const group = useMemo(() => {
    // The map guard is not belt and braces: the selection outlives this
    // component. Switch to the 3D view with a run of fence picked and come
    // back, and this memo runs on the first render of a fresh map — before
    // there is one — and took the whole page down with it.
    if (!map || !ready || selection.items.length < 2) return null
    const pts = shown.filter((i) => selection.items.includes(i.id)).map((i) => project([i.lng, i.lat]))
    const centre = centroidPx(pts)
    if (!centre) return null
    return {
      centre,
      box: {
        x1: Math.min(...pts.map((p) => p.x)),
        y1: Math.min(...pts.map((p) => p.y)),
        x2: Math.max(...pts.map((p) => p.x)),
        y2: Math.max(...pts.map((p) => p.y)),
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, shown, project, frame])

  const cursorClass =
    readOnly ? '' : tool === 'place' ? 'cursor-copy' : tool === 'draw' || tool === 'measure' ? 'cursor-crosshair' : ''

  /**
   * Can anything on the overlay be grabbed right now?
   *
   * Only in Select mode, and the reason is not tidiness: anything the overlay
   * accepts a click on is a click the map never sees, so a panel left
   * grabbable in Place mode is a panel you cannot put another one beside.
   */
  const grabbable = !readOnly && tool === 'select'

  const measureLive = cursor && measure.length === 1 ? [...measure, cursor] : measure
  const measureM = measureLive.length >= 2 ? pathLengthM(measureLive) : 0

  return (
    <div ref={box} className={`relative h-full w-full bg-stone-200 ${cursorClass}`}>
      {/* The overlay sits above the map by z-index, not by DOM order.
          MapLibre injects its canvas as a sibling of this overlay inside the
          container it was given, and which of them ends up last depends on the
          order React happens to mount its own children in — which shifts when
          any other child of this div appears or disappears. Get it wrong and
          the canvas paints over the whole layout: every panel, pen and handle
          still there, still clickable, and invisible. */}
      {map && ready && (
        <svg ref={svg} className="pointer-events-none absolute inset-0 z-10 h-full w-full">
          {/* Bottom to top: uploaded layers, pens, what is being drawn, the
              snap ring, the kit, the measure line. */}
          {kmlShapes.map((s, i) => (
            <g key={i} opacity={0.9}>
              {s.rings.map((r, j) => (
                <path key={j} d={d(r)} fill="none" stroke={s.color} strokeWidth={2} />
              ))}
              {s.points.map((p, j) => (
                <circle key={j} cx={project(p).x} cy={project(p).y} r={4} fill={s.color} stroke="#fff" strokeWidth={1} />
              ))}
            </g>
          ))}

          {showPens &&
            paths.map((p) => {
              const pts = pointsOf(p)
              const chosen = isPathSel(p.id)
              // Corner handles only when this pen is the one thing picked.
              // Twenty handles over five pens is a screen you cannot read.
              const alone = chosen && selectionSize(selection) === 1
              const head = penHead[p.id] ?? 0
              const sqft = p.is_closed ? areaFt2(pts) : 0
              const cap = p.is_closed ? penCapacity(sqft, p.usage_type) : null
              const fit = !cap ? 'empty' : head <= 0 ? 'empty' : head <= cap.low ? 'fits' : head <= cap.high ? 'marginal' : 'over'
              const colour = p.is_closed ? FIT_COLOR[fit] : p.color
              // The label goes in the middle of the pen, not on one of its
              // corners: the mean of the corners, which for a corral pen is
              // the centre anybody would point at.
              const mid = pts.length
                ? {
                    x: pts.reduce((s, pt) => s + project(pt).x, 0) / pts.length,
                    y: pts.reduce((s, pt) => s + project(pt).y, 0) / pts.length,
                  }
                : null
              return (
                <g key={p.id}>
                  <path
                    d={d(pts, p.is_closed)}
                    fill={p.is_closed ? colour : 'none'}
                    fillOpacity={p.is_closed ? 0.12 : 0}
                    stroke={colour}
                    strokeWidth={chosen ? p.stroke_width + 2 : p.stroke_width}
                    strokeDasharray={p.is_closed ? undefined : '8 5'}
                  />
                  {/* A fat invisible line so a two-pixel fence can be grabbed. */}
                  {grabbable && (
                    <path
                      d={d(pts, p.is_closed)}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={16}
                      className="pointer-events-auto cursor-pointer"
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        clicked('path', p.id, e)
                      }}
                    />
                  )}
                  {p.is_closed && mid && (
                    <text
                      x={mid.x}
                      y={mid.y}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill="#fff"
                      stroke="#1f2937"
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      {p.label || 'Pen'}
                      {sqft > 0 && ` · ${Math.round(sqft).toLocaleString('en-CA')} ft²`}
                    </text>
                  )}
                  {alone && grabbable && (
                    <>
                      {pts.map((pt, i) => {
                        const s = project(pt)
                        return (
                          <circle
                            key={`v${i}`}
                            cx={s.x}
                            cy={s.y}
                            r={6}
                            fill="#fff"
                            stroke="#0ea5e9"
                            strokeWidth={2}
                            className="pointer-events-auto cursor-move"
                            onPointerDown={startDrag({ kind: 'vertex', pathId: p.id, index: i })}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              // A ring needs three corners to still be a shape.
                              if (p.is_closed && pts.length <= 3) return
                              if (pts.length <= 2) return
                              edit.updatePath(p.id, {
                                points: pts.filter((_, j) => j !== i) as [number, number][],
                              })
                            }}
                          />
                        )
                      })}
                      {pts.map((pt, i) => {
                        const next = pts[i + 1] ?? (p.is_closed ? pts[0] : null)
                        if (!next) return null
                        const a = project(pt)
                        const b = project(next)
                        return (
                          <circle
                            key={`m${i}`}
                            cx={(a.x + b.x) / 2}
                            cy={(a.y + b.y) / 2}
                            r={4}
                            fill="#fff"
                            fillOpacity={0.6}
                            stroke="#0ea5e9"
                            strokeWidth={1.5}
                            className="pointer-events-auto cursor-copy"
                            onPointerDown={startDrag({ kind: 'midpoint', pathId: p.id, index: i })}
                          />
                        )
                      })}
                    </>
                  )}
                </g>
              )
            })}

          {drawing.length > 0 && (
            <>
              <path
                d={d(cursor ? [...drawing, cursor] : drawing)}
                fill="none"
                stroke="#22d3ee"
                strokeWidth={2.5}
                strokeDasharray="6 4"
              />
              {drawing.map((pt, i) => {
                const s = project(pt)
                return <circle key={i} cx={s.x} cy={s.y} r={4} fill="#22d3ee" stroke="#fff" strokeWidth={1.5} />
              })}
            </>
          )}

          {snap && <circle cx={snap.x} cy={snap.y} r={10} fill="none" stroke="#22d3ee" strokeWidth={2.5} />}

          <g style={{ filter: HALO }}>
          {shown.map((it) => {
            const cat = byId.get(it.catalog_id)
            if (!cat) return null
            const s = project([it.lng, it.lat])
            const chosen = isItemSel(it.id)
            const alone = chosen && selectionSize(selection) === 1
            const w = cat.width_ft * pxPerFt
            return (
              <g key={it.id} data-item-id={it.id} transform={`translate(${s.x} ${s.y})`}>
                <g transform={`rotate(${it.rotation})`}>
                  {/* A 16 px grab zone: a panel is a 3 px line and nobody can
                      hit a 3 px line with a thumb. */}
                  {grabbable && (
                    <rect
                      x={-Math.max(w, 16) / 2}
                      y={-8}
                      width={Math.max(w, 16)}
                      height={16}
                      fill="transparent"
                      className="pointer-events-auto cursor-move"
                      onPointerDown={(e) => {
                        const additive = e.shiftKey || e.ctrlKey || e.metaKey
                        clicked('item', it.id, e)
                        // A shift-click picks something; it does not start
                        // dragging it. Otherwise adding the sixth panel to a
                        // group nudges it off the fence line.
                        if (additive) return
                        const group = isItemSel(it.id) && selection.items.length > 1 ? selection.items : [it.id]
                        startDrag({
                          kind: 'item',
                          id: it.id,
                          from: toLngLat(e) ?? [it.lng, it.lat],
                          origin: originOf(group),
                        })(e)
                      }}
                    />
                  )}
                  <ItemGlyph item={cat} pxPerFt={pxPerFt} rotation={it.rotation} swing={it.swing_deg} dim={readOnly} />
                  {/* The one handle that DOES turn with its item: a gate's
                      swing handle lives on the end of the leaf, because the
                      end of the leaf is the thing being moved. */}
                  {alone && grabbable && cat.gate_type && cat.gate_type !== 'drive-over' && (
                    <SwingHandle
                      w={w}
                      swing={it.swing_deg}
                      twoPanel={cat.gate_type === 'two-panel'}
                      onDown={startDrag({ kind: 'swing', id: it.id })}
                    />
                  )}
                  {chosen && (
                    <rect
                      x={-Math.max(w, 16) / 2 - 3}
                      y={-Math.max(cat.depth_ft * pxPerFt, 12) / 2 - 3}
                      width={Math.max(w, 16) + 6}
                      height={Math.max(cat.depth_ft * pxPerFt, 12) + 6}
                      fill="none"
                      stroke="#0ea5e9"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                  )}
                </g>
                {alone && grabbable && (
                  <>
                    {/* The handles do NOT rotate with the item: a grab point
                        that moves as you turn it is a grab point you chase. */}
                    <line x1={0} y1={0} x2={0} y2={-30} stroke="#0ea5e9" strokeWidth={1.5} />
                    <circle
                      cx={0}
                      cy={-30}
                      r={7}
                      fill="#0ea5e9"
                      stroke="#fff"
                      strokeWidth={2}
                      className="pointer-events-auto cursor-grab"
                      onPointerDown={startDrag({ kind: 'rotate', id: it.id })}
                    />
                    <g
                      transform="translate(22 -22)"
                      className="pointer-events-auto cursor-pointer"
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        edit.removeItems([it.id])
                        onSelect(NO_SELECTION)
                      }}
                    >
                      <circle r={9} fill="#dc2626" stroke="#fff" strokeWidth={2} />
                      <path d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5" stroke="#fff" strokeWidth={2} />
                    </g>
                  </>
                )}
              </g>
            )
          })}

          </g>

          {/* What is about to be dropped, and the join it would make. */}
          {ghostShown && placing && (
            <Ghosted
              cat={byId.get(placing) ?? null}
              ghost={ghostShown}
              pxPerFt={pxPerFt}
              project={project}
              items={items}
              byId={byId}
            />
          )}

          {/* One set of handles for a whole group: turn it, or take it out. */}
          {group && grabbable && (
            <g>
              <rect
                x={group.box.x1 - 14}
                y={group.box.y1 - 14}
                width={group.box.x2 - group.box.x1 + 28}
                height={group.box.y2 - group.box.y1 + 28}
                fill="#0ea5e9"
                fillOpacity={0.06}
                stroke="#0ea5e9"
                strokeWidth={1.5}
                strokeDasharray="6 4"
              />
              <line
                x1={group.centre.x}
                y1={group.box.y1 - 14}
                x2={group.centre.x}
                y2={group.box.y1 - 40}
                stroke="#0ea5e9"
                strokeWidth={1.5}
              />
              <circle
                cx={group.centre.x}
                cy={group.box.y1 - 40}
                r={8}
                fill="#0ea5e9"
                stroke="#fff"
                strokeWidth={2}
                className="pointer-events-auto cursor-grab"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  if (!map) return
                  const r = box.current?.getBoundingClientRect()
                  const p = r ? { x: e.clientX - r.left, y: e.clientY - r.top } : group.centre
                  const c = map.unproject([group.centre.x, group.centre.y])
                  drag.current = {
                    kind: 'spin',
                    centre: [c.lng, c.lat],
                    startDeg: (Math.atan2(p.y - group.centre.y, p.x - group.centre.x) * 180) / Math.PI,
                    origin: originOf(selection.items),
                  }
                  map.dragPan.disable()
                  ;(e.target as Element).setPointerCapture?.(e.pointerId)
                }}
              />
              <g
                transform={`translate(${group.box.x2 + 14} ${group.box.y1 - 14})`}
                className="pointer-events-auto cursor-pointer"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  edit.removeItems(selection.items)
                  if (selection.paths.length) edit.removePaths(selection.paths)
                  onSelect(NO_SELECTION)
                }}
              >
                <circle r={9} fill="#dc2626" stroke="#fff" strokeWidth={2} />
                <path d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5" stroke="#fff" strokeWidth={2} />
              </g>
            </g>
          )}

          {marqueeBox && (
            <rect
              x={normBox(marqueeBox).x1}
              y={normBox(marqueeBox).y1}
              width={normBox(marqueeBox).x2 - normBox(marqueeBox).x1}
              height={normBox(marqueeBox).y2 - normBox(marqueeBox).y1}
              fill="#0ea5e9"
              fillOpacity={0.14}
              stroke="#0ea5e9"
              strokeWidth={1.5}
              strokeDasharray="5 3"
            />
          )}

          {measureLive.length >= 2 && (
            <>
              <path d={d(measureLive)} fill="none" stroke="#fde047" strokeWidth={2.5} />
              {measureLive.map((pt, i) => {
                const s = project(pt)
                return <circle key={i} cx={s.x} cy={s.y} r={4} fill="#fde047" stroke="#111827" strokeWidth={1.5} />
              })}
            </>
          )}
        </svg>
      )}

      {map && ready && (
        <button
          type="button"
          onClick={() => setBasemap((b) => BASEMAP_NEXT[b])}
          className="absolute left-2 top-2 z-20 rounded-md bg-gray-900/85 px-2.5 py-1.5 text-xs font-medium text-white shadow hover:bg-gray-900"
        >
          {BASEMAP_LABEL[basemap]}
        </button>
      )}

      {/* ── Readouts ─────────────────────────────────────────────────────────
          Clear of the bottom of the map, not at it: the Esri credit sits there
          and wraps to two lines on a narrow map, which put the measurement
          behind it. */}
      {!readOnly && tool === 'measure' && (
        <div className="absolute bottom-16 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full bg-gray-900/85 px-4 py-2 text-sm text-white shadow-lg">
          <span className="font-semibold tabular-nums">
            {measureLive.length < 2 ? 'Click two points' : formatDistance(measureM, metric ? 'm' : 'ft')}
          </span>
          <button onClick={() => setMetric((m) => !m)} className="rounded bg-white/15 px-2 py-0.5 text-xs hover:bg-white/25">
            {metric ? 'metres' : 'feet'}
          </button>
          {measure.length > 0 && (
            <button onClick={() => setMeasure([])} className="text-white/60 hover:text-white" aria-label="Clear the measurement">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {!readOnly && tool === 'select' && (
        <div className="absolute bottom-16 left-1/2 z-20 -translate-x-1/2 rounded-full bg-gray-900/85 px-4 py-2 text-xs text-white shadow-lg">
          {selectionSize(selection) === 0 ? (
            <>Shift-drag a box to pick a run · shift-click to add one</>
          ) : (
            <>
              <span className="font-semibold">{selectionWords(selection)}</span> picked
              {selection.items.length > 1 && ' · the handle turns the group'} · Delete removes
            </>
          )}
        </div>
      )}

      {!readOnly && tool === 'draw' && (
        <div className="absolute bottom-16 left-1/2 z-20 -translate-x-1/2 rounded-full bg-gray-900/85 px-4 py-2 text-xs text-white shadow-lg">
          Click the corners · double-click to close it as a pen · Enter for an open line · Esc to cancel
          {drawing.length > 0 && <span className="ml-2 font-semibold">{drawing.length} corners</span>}
        </div>
      )}

      {!readOnly && tool === 'place' && (
        <div className="absolute bottom-16 left-1/2 z-20 -translate-x-1/2 rounded-full bg-gray-900/85 px-4 py-2 text-xs text-white shadow-lg">
          {placing
            ? 'Click to drop it · the wheel turns it · green ends mean it will join on · S to stop'
            : 'Pick something from the Library, then click the map'}
        </div>
      )}
    </div>
  )
}
