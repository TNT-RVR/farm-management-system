import type { CatalogRow } from '@/lib/handling-data'
import { labelSpin } from '@/lib/handling'

/**
 * How each piece of kit draws, seen from above.
 *
 * Everything here is in the item's own coordinates: x runs along its width,
 * (0,0) is its centre, and the caller has already translated and rotated the
 * group. Sizes are in screen pixels, worked out from the real feet, so a 10 ft
 * panel is a tenth as long as a 100 ft run at every zoom.
 *
 * A panel is drawn as a LINE and not a box on purpose. Overhead, a fence panel
 * IS a line — 5.5 ft is how tall it stands, not how much ground it takes — and
 * drawing it 5.5 ft deep would make a corral look like a wall of sheds and hide
 * the gap a gate needs.
 */

/** Marks that must stay readable rather than scale: caps, hinges, hairlines. */
const CAP_PX = 4
const HINGE_PX = 3

type GlyphProps = {
  item: CatalogRow
  /** Screen pixels in one foot, at this zoom and latitude. */
  pxPerFt: number
  /** Degrees the group is rotated by, so a label can be turned back upright. */
  rotation: number
  /** Degrees a gate leaf is swung open; 0 on everything else. */
  swing?: number
  dim?: boolean
}

const feet = (ft: number) => (ft % 1 === 0 ? `${ft}'` : `${ft}'`)

/** Round in life: tanks, round bale feeders, tubs. */
const isRound = (item: CatalogRow) =>
  item.width_ft === item.depth_ft &&
  (item.category === 'Water' || item.category === 'Hay feeder' || item.category === 'Salt / mineral')

export function ItemGlyph({ item, pxPerFt, rotation, swing = 0, dim }: GlyphProps) {
  const w = item.width_ft * pxPerFt
  const d = item.depth_ft * pxPerFt
  const opacity = dim ? 0.45 : 1

  if (item.panel_type) return <PanelGlyph item={item} w={w} rotation={rotation} opacity={opacity} />
  if (item.gate_type) return <GateGlyph item={item} w={w} rotation={rotation} opacity={opacity} swing={swing} />
  if (item.category === 'Sorting gate') return <SortingGateGlyph w={w} color={item.color} opacity={opacity} />
  if (item.animal_type) return <AnimalGlyph w={w} d={d} color={item.color} opacity={opacity} bull={item.animal_type === 'bull'} />
  if (item.category === 'Equipment')
    return <MachineGlyph item={item} w={w} d={d} color={item.color} opacity={opacity} pxPerFt={pxPerFt} />

  // Troughs, bunks, feeders and tubs: real ground footprint, so a real box.
  return isRound(item) ? (
    <ellipse rx={w / 2} ry={d / 2} fill={item.color} fillOpacity={0.35 * opacity} stroke={item.color} strokeWidth={1.5} strokeOpacity={opacity} />
  ) : (
    <rect
      x={-w / 2}
      y={-d / 2}
      width={w}
      height={Math.max(d, 2)}
      fill={item.color}
      fillOpacity={0.35 * opacity}
      stroke={item.color}
      strokeWidth={1.5}
      strokeOpacity={opacity}
    />
  )
}

/** A length label that reads left to right whichever way the item is turned. */
function SizeLabel({ text, w, rotation, color }: { text: string; w: number; rotation: number; color: string }) {
  // Below about this long there is no room for text inside the piece, and a
  // label longer than the panel it names is noise on a yard of forty panels.
  if (w < 26) return null
  return (
    <g transform={`rotate(${labelSpin(rotation)})`}>
      <text
        y={-7}
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        fill="#fff"
        stroke={color}
        strokeWidth={2.5}
        paintOrder="stroke"
      >
        {text}
      </text>
    </g>
  )
}

function PanelGlyph({ item, w, rotation, opacity }: { item: CatalogRow; w: number; rotation: number; opacity: number }) {
  const half = w / 2
  const wind = item.panel_type === 'wind-fence'
  return (
    <g strokeOpacity={opacity}>
      {wind ? (
        <>
          <line x1={-half} y1={-2} x2={half} y2={-2} stroke={item.color} strokeWidth={2.5} />
          <line x1={-half} y1={2} x2={half} y2={2} stroke={item.color} strokeWidth={2.5} />
          {w >= 34 && (
            <g transform={`rotate(${labelSpin(rotation)})`}>
              <text y={-8} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff" stroke={item.color} strokeWidth={2.5} paintOrder="stroke">
                WF {feet(item.width_ft)}
              </text>
            </g>
          )}
        </>
      ) : (
        <>
          <line x1={-half} y1={0} x2={half} y2={0} stroke={item.color} strokeWidth={3} strokeLinecap="round" />
          <line x1={-half} y1={-CAP_PX} x2={-half} y2={CAP_PX} stroke={item.color} strokeWidth={2} />
          <line x1={half} y1={-CAP_PX} x2={half} y2={CAP_PX} stroke={item.color} strokeWidth={2} />
          <SizeLabel text={feet(item.width_ft)} w={w} rotation={rotation} color={item.color} />
        </>
      )}
    </g>
  )
}

function GateGlyph({
  item,
  w,
  rotation,
  opacity,
  swing,
}: {
  item: CatalogRow
  w: number
  rotation: number
  opacity: number
  swing: number
}) {
  const half = w / 2
  if (item.gate_type === 'drive-over') {
    return (
      <g strokeOpacity={opacity}>
        <line x1={-half} y1={0} x2={half} y2={0} stroke={item.color} strokeWidth={3} strokeDasharray="6 4" />
        {w >= 30 && (
          <g transform={`rotate(${labelSpin(rotation)})`}>
            <text y={-7} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff" stroke={item.color} strokeWidth={2.5} paintOrder="stroke">
              DO {feet(item.width_ft)}
            </text>
          </g>
        )}
      </g>
    )
  }

  if (item.gate_type === 'two-panel') {
    return (
      <g strokeOpacity={opacity}>
        <SweepArc hinge={-half} span={half} swing={swing} color={item.color} />
        <SweepArc hinge={half} span={-half} swing={-swing} color={item.color} />
        {/* Two leaves meeting mid-span, each hinged on its own post. They turn
            in opposite senses, which is how both of them open the same way. */}
        <g transform={`rotate(${swing} ${-half} 0)`}>
          <line x1={-half} y1={0} x2={-1.5} y2={0} stroke={item.color} strokeWidth={3} strokeLinecap="round" />
        </g>
        <g transform={`rotate(${-swing} ${half} 0)`}>
          <line x1={1.5} y1={0} x2={half} y2={0} stroke={item.color} strokeWidth={3} strokeLinecap="round" />
        </g>
        <circle cx={-half} cy={0} r={HINGE_PX} fill={item.color} />
        <circle cx={half} cy={0} r={HINGE_PX} fill={item.color} />
        {!swing && <SizeLabel text={feet(item.width_ft)} w={w} rotation={rotation} color={item.color} />}
      </g>
    )
  }

  // Swinging: hinged at the left end, and the arc is the ground it needs to
  // open over. That arc is the whole reason to draw a gate differently from a
  // panel — it is what tells you the gate cannot open into the trough.
  return (
    <g strokeOpacity={opacity}>
      <SweepArc hinge={-half} span={w} swing={swing} color={item.color} />
      <g transform={`rotate(${swing} ${-half} 0)`}>
        <line x1={-half} y1={0} x2={half} y2={0} stroke={item.color} strokeWidth={3} strokeLinecap="round" />
      </g>
      <circle cx={-half} cy={0} r={HINGE_PX} fill={item.color} />
      {!swing && <SizeLabel text={feet(item.width_ft)} w={w} rotation={rotation} color={item.color} />}
    </g>
  )
}

/**
 * The ground a gate needs to open over: hinge at `hinge`, leaf reaching `span`
 * (negative for a leaf that points back the other way).
 *
 * Always at least a quarter turn, because that is the clearance worth seeing
 * even on a gate standing shut, and wider once the gate has been swung past
 * it. Drawn where the leaf will go, not where it has been.
 */
function SweepArc({ hinge, span, swing, color }: { hinge: number; span: number; swing: number; color: string }) {
  const r = Math.abs(span)
  if (r < 6) return null
  const sweep = Math.max(90, Math.abs(swing))
  const side = swing < 0 ? -1 : 1
  const t = ((side * sweep) * Math.PI) / 180
  const x = hinge + span * Math.cos(t)
  const y = span * Math.sin(t)
  return (
    <path
      d={`M ${hinge + span} 0 A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} ${side > 0 ? 1 : 0} ${x} ${y}`}
      fill="none"
      stroke={color}
      strokeWidth={1}
      strokeDasharray="3 3"
      opacity={0.7}
    />
  )
}

/** Five arms at 72°, which is what a five-way sorting gate is. */
function SortingGateGlyph({ w, color, opacity }: { w: number; color: string; opacity: number }) {
  const r = w / 2
  return (
    <g strokeOpacity={opacity}>
      <circle r={r} fill={color} fillOpacity={0.12 * opacity} stroke={color} strokeWidth={1} strokeDasharray="3 3" />
      {[0, 72, 144, 216, 288].map((deg) => {
        const rad = (deg * Math.PI) / 180
        return (
          <line
            key={deg}
            x1={0}
            y1={0}
            x2={Math.cos(rad) * r}
            y2={Math.sin(rad) * r}
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        )
      })}
      <circle r={HINGE_PX} fill={color} />
    </g>
  )
}

/**
 * A beast from above: barrel, neck, head, ears and tail.
 *
 * Nose at +x, so a cow in an alley reads as facing somewhere — which was the
 * whole job of the old blob-and-dot, and this one also shows how much of the
 * alley she actually fills. Every number is a fraction of the row's own
 * length and width, so a corrected measurement restretches her.
 */
function AnimalGlyph({ w, d, color, opacity, bull }: { w: number; d: number; color: string; opacity: number; bull: boolean }) {
  const neck = bull ? 0.3 : 0.24
  const head = bull ? 0.2 : 0.17
  const barrel = [
    `M ${0.28 * w} 0`,
    `C ${0.28 * w} ${-0.46 * d}, ${0.05 * w} ${-0.5 * d}, ${-0.14 * w} ${-0.5 * d}`,
    `C ${-0.36 * w} ${-0.5 * d}, ${-0.46 * w} ${-0.34 * d}, ${-0.46 * w} 0`,
    `C ${-0.46 * w} ${0.34 * d}, ${-0.36 * w} ${0.5 * d}, ${-0.14 * w} ${0.5 * d}`,
    `C ${0.05 * w} ${0.5 * d}, ${0.28 * w} ${0.46 * d}, ${0.28 * w} 0`,
    'Z',
  ].join(' ')
  return (
    <g fillOpacity={opacity} strokeOpacity={opacity}>
      <path
        d={`M ${0.24 * w} ${-neck * d} L ${0.38 * w} ${-head * d} L ${0.38 * w} ${head * d} L ${0.24 * w} ${neck * d} Z`}
        fill={color}
        fillOpacity={0.5 * opacity}
        stroke={color}
        strokeWidth={1}
      />
      <path d={barrel} fill={color} fillOpacity={0.55 * opacity} stroke={color} strokeWidth={1.2} />
      {/* Ears, which is what makes the front end read as a head and not a nose cone. */}
      {[-1, 1].map((s) => (
        <ellipse key={s} cx={0.36 * w} cy={s * 0.25 * d} rx={0.035 * w} ry={0.07 * d} fill={color} fillOpacity={0.75 * opacity} />
      ))}
      <ellipse cx={0.4 * w} cy={0} rx={0.1 * w} ry={head * d} fill={color} fillOpacity={0.85 * opacity} stroke={color} strokeWidth={1} />
      <line x1={-0.46 * w} y1={0} x2={-0.5 * w} y2={0.03 * d} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    </g>
  )
}

/**
 * The Bale Pro, from its own spec sheet: what the footprint does not say.
 *
 * The stored footprint is the transport one — 14 ft 6 in from the hitch to the
 * back tires, 9 ft 4 in wide — because that is what you drive through a gate.
 * Working, it is longer at the back and wider down one side, and those are the
 * two numbers that decide whether it can actually run where it is parked.
 */
const FORK_DOWN_FT = 4.1
const DEFLECTOR_FT = 3.5
const BALE_PRO_KEY = 'jd-7710-balepro'

/** Tractor and the chopper behind it, as one machine, pointing +x. */
function MachineGlyph({
  item,
  w,
  d,
  color,
  opacity,
  pxPerFt,
}: {
  item: CatalogRow
  w: number
  d: number
  color: string
  opacity: number
  pxPerFt: number
}) {
  const body = { fill: color, fillOpacity: 0.3 * opacity, stroke: color, strokeWidth: 1.2, strokeOpacity: opacity }
  const tyre = { fill: color, fillOpacity: 0.75 * opacity, stroke: 'none' }
  const wheel = (x: number, len: number, s: number, y0: number, y1: number) => (
    <rect key={`${x}:${s}`} x={x * w} y={s > 0 ? y0 * d : -y1 * d} width={len * w} height={(y1 - y0) * d} {...tyre} />
  )
  // Room to run, not room to park: drawn dashed and outside the footprint, the
  // same way a gate's swing arc is.
  const extras = item.key === BALE_PRO_KEY && w > 70
  return (
    <g>
      {extras && (
        <g fill="none" stroke={color} strokeWidth={1} strokeOpacity={0.75 * opacity} strokeDasharray="4 3">
          <path d={`M ${-0.47 * w} ${0.5 * d} L ${-0.47 * w} ${d / 2 + DEFLECTOR_FT * pxPerFt} L ${-0.04 * w} ${d / 2 + DEFLECTOR_FT * pxPerFt} L ${-0.04 * w} ${0.5 * d}`} />
          <path d={`M ${-0.47 * w} ${-0.46 * d} L ${-0.47 * w - FORK_DOWN_FT * pxPerFt} ${-0.46 * d} L ${-0.47 * w - FORK_DOWN_FT * pxPerFt} ${0.46 * d} L ${-0.47 * w} ${0.46 * d}`} />
        </g>
      )}
      {wheel(0.02, 0.16, 1, 0.32, 0.5)}
      {wheel(0.02, 0.16, -1, 0.32, 0.5)}
      {wheel(0.34, 0.12, 1, 0.3, 0.44)}
      {wheel(0.34, 0.12, -1, 0.3, 0.44)}
      {wheel(-0.34, 0.12, 1, 0.4, 0.5)}
      {wheel(-0.34, 0.12, -1, 0.4, 0.5)}
      {/* Chopper: the tub, and the chute it throws out of. */}
      <rect x={-0.47 * w} y={-0.46 * d} width={0.43 * w} height={0.92 * d} rx={0.05 * w} {...body} />
      <rect x={-0.3 * w} y={0.4 * d} width={0.18 * w} height={0.12 * d} {...body} />
      <line x1={0.04 * w} y1={0} x2={-0.04 * w} y2={0} stroke={color} strokeWidth={1.6} strokeOpacity={opacity} />
      {/* Tractor: cab over the back axle, hood out front. */}
      <rect x={0.06 * w} y={-0.26 * d} width={0.24 * w} height={0.52 * d} rx={0.02 * w} {...body} />
      <rect x={0.3 * w} y={-0.18 * d} width={0.18 * w} height={0.36 * d} rx={0.015 * w} {...body} />
    </g>
  )
}

/**
 * The same glyph at a fixed size for the Library list, so picking a panel is
 * picking a picture of it rather than reading a name twice.
 */
export function GlyphThumb({ item }: { item: CatalogRow }) {
  const longest = Math.max(item.width_ft, item.depth_ft)
  const pxPerFt = 30 / longest
  return (
    <svg width={38} height={26} viewBox="-19 -13 38 26" aria-hidden className="shrink-0">
      <g>
        <ItemGlyph item={item} pxPerFt={pxPerFt} rotation={0} />
      </g>
    </svg>
  )
}
