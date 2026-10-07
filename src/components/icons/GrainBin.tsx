import type { SVGProps } from 'react'

/**
 * A grain bin: a cone roof on a ribbed round bin.
 *
 * Drawn to match the icon set (24 × 24, 2 px round strokes, currentColor),
 * which has a warehouse and a shipping container but nothing a farm would
 * call a bin.
 */
export function GrainBin({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {/* the vent cap and the cone roof */}
      <path d="M11 2.5h2" />
      <path d="M4 9.5 12 3.5l8 6" />
      {/* the bin wall, and two of its rings */}
      <path d="M5 9.5V21h14V9.5" />
      <path d="M5 13.5h14" />
      <path d="M5 17.5h14" />
    </svg>
  )
}
