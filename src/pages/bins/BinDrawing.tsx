import { useId } from 'react'
import { readableOn } from '@/lib/crop-colour'

/**
 * A bin, drawn.
 *
 * The point is the fill line: how full this bin is, in the colour of what is in
 * it, readable from across a room. A row of numbers in a table does not answer
 * "how much room have I got left" the way a shape half full of green does.
 *
 * Hopper-bottomed bins are drawn on legs with a cone, flat-bottomed ones sit on
 * the ground, because that is how somebody in the yard recognises which is
 * which — and the yard has both.
 */
export function BinDrawing({
  capacityBu,
  fillBu,
  colour,
  label,
  hopper,
  className,
}: {
  capacityBu: number
  fillBu: number
  /** Crop colour, or the empty-bin grey. */
  colour: string
  /** Crop name, drawn inside the fill when there is room. */
  label?: string | null
  hopper?: boolean
  className?: string
}) {
  // Unique per instance: a page showing every bin in a yard would otherwise
  // have thirty elements all claiming the id "barrel", and every one of them
  // would clip to the first bin's geometry.
  const clip = useId()
  const share = capacityBu > 0 ? Math.max(0, Math.min(1, fillBu / capacityBu)) : 0

  // Geometry in a 120x170 box: roof, barrel, then either a cone on legs or a
  // flat floor. Only the barrel holds grain — a fill line drawn through the
  // roof would overstate a nearly-full bin.
  const left = 22
  const right = 98
  const roofTop = 14
  const barrelTop = 34
  const barrelBottom = hopper ? 116 : 140
  const barrelH = barrelBottom - barrelTop
  const fillTop = barrelBottom - barrelH * share

  const stroke = '#334155'
  const empty = share === 0

  return (
    <svg
      viewBox="0 0 120 170"
      className={className}
      role="img"
      aria-label={`${Math.round(share * 100)}% full`}
    >
      {/* Grain, clipped to the barrel so the corners stay square with the wall. */}
      <clipPath id={clip}>
        <rect x={left} y={barrelTop} width={right - left} height={barrelH} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect
          x={left}
          y={fillTop}
          width={right - left}
          height={barrelBottom - fillTop}
          fill={colour}
        />
      </g>

      {/* The fill line itself, drawn over the grain and across the full width. */}
      {!empty && share < 1 && (
        <line
          x1={left}
          y1={fillTop}
          x2={right}
          y2={fillTop}
          stroke={stroke}
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      )}

      {/* Corrugation, faint, so the barrel reads as a bin and not a jar. */}
      {[50, 66, 82, 98].map((y) =>
        y < barrelBottom ? (
          <line key={y} x1={left} y1={y} x2={right} y2={y} stroke={stroke} strokeOpacity={0.15} />
        ) : null,
      )}

      {/* Barrel wall. */}
      <rect
        x={left}
        y={barrelTop}
        width={right - left}
        height={barrelH}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
      />

      {/* Roof. */}
      <path
        d={`M ${left} ${barrelTop} L 60 ${roofTop} L ${right} ${barrelTop} Z`}
        fill="#e2e8f0"
        stroke={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <line x1={54} y1={roofTop + 2} x2={66} y2={roofTop + 2} stroke={stroke} strokeWidth={2} />

      {hopper ? (
        <>
          {/* Cone and legs. */}
          <path
            d={`M ${left} ${barrelBottom} L 60 ${barrelBottom + 22} L ${right} ${barrelBottom} Z`}
            fill={empty ? '#f1f5f9' : colour}
            stroke={stroke}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <line x1={32} y1={barrelBottom} x2={26} y2={158} stroke={stroke} strokeWidth={2} />
          <line x1={88} y1={barrelBottom} x2={94} y2={158} stroke={stroke} strokeWidth={2} />
          <line x1={20} y1={158} x2={100} y2={158} stroke={stroke} strokeWidth={2} />
        </>
      ) : (
        <line
          x1={14}
          y1={barrelBottom}
          x2={106}
          y2={barrelBottom}
          stroke={stroke}
          strokeWidth={2}
        />
      )}

      {/* Crop name inside the grain, only where it will not be cramped. */}
      {label && share > 0.22 && (
        <text
          x={60}
          y={fillTop + (barrelBottom - fillTop) / 2 + 4}
          textAnchor="middle"
          fontSize={11}
          fontWeight={600}
          fill={readableOn(colour)}
        >
          {label.length > 12 ? `${label.slice(0, 11)}…` : label}
        </text>
      )}
    </svg>
  )
}
