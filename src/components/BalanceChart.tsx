import { useMemo } from 'react'
import type { WaterBalanceRow } from '@/lib/irrigation'

/**
 * Season curve of root-zone depletion against RAW and TAW, with the forward
 * projection from forecast weather (spec §12.1, AIMM-style).
 *
 * Plain SVG on purpose — a charting library would be a new dependency for one
 * read-only chart. Depletion is drawn downward: where the solid line crosses the
 * RAW band the field needed water; where the dashed projection crosses it, it
 * will need water if nothing is applied.
 */
const W = 640
const H = 170
const PAD = { l: 34, r: 8, t: 8, b: 26 }

export function BalanceChart({ rows }: { rows: WaterBalanceRow[] }) {
  const model = useMemo(() => {
    const pts = rows
      .filter((r) => r.dr_mm != null)
      .map((r) => ({
        date: r.date,
        dr: Number(r.dr_mm),
        raw: r.raw_mm == null ? null : Number(r.raw_mm),
        taw: r.taw_mm == null ? null : Number(r.taw_mm),
        status: r.status,
        forecast: r.is_forecast,
      }))
    if (pts.length === 0) return null
    const maxY = Math.max(...pts.map((p) => Math.max(p.dr, p.taw ?? 0))) * 1.05 || 1
    const x = (i: number) => PAD.l + (i / Math.max(1, pts.length - 1)) * (W - PAD.l - PAD.r)
    const y = (v: number) => PAD.t + (v / maxY) * (H - PAD.t - PAD.b)
    const firstForecast = pts.findIndex((p) => p.forecast)
    // First projected day that reaches the irrigate trigger.
    const crossing = pts.findIndex(
      (p) => p.forecast && (p.status === 'now' || p.status === 'stress'),
    )
    return { pts, maxY, x, y, firstForecast, crossing }
  }, [rows])

  if (!model) return <p className="py-6 text-center text-xs text-gray-400">No season data yet.</p>
  const { pts, maxY, x, y, firstForecast, crossing } = model

  const path = (pick: (i: number) => boolean, val: (p: (typeof pts)[number]) => number | null) => {
    let d = ''
    let started = false
    pts.forEach((p, i) => {
      const v = val(p)
      if (v == null || !pick(i)) {
        started = false
        return
      }
      d += `${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
      started = true
    })
    return d
  }

  const hasForecast = firstForecast >= 0
  // Overlap by one point so the actual and projected lines join up.
  const isActual = (i: number) => !hasForecast || i <= firstForecast
  const isForecast = (i: number) => hasForecast && i >= Math.max(0, firstForecast - 1)

  const ticks = [0, maxY / 2, maxY]
  const labelEvery = Math.ceil(pts.length / 6)

  return (
    <figure className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-44 w-full min-w-[420px]"
        role="img"
        aria-label="Season soil-water depletion with forecast projection"
      >
        {hasForecast && (
          <rect
            x={x(firstForecast)}
            y={PAD.t}
            width={W - PAD.r - x(firstForecast)}
            height={H - PAD.t - PAD.b}
            fill="#f8fafc"
          />
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#f1f5f9" />
            <text x={4} y={y(t) + 3} className="fill-gray-400 text-[9px]">
              {Math.round(t)}
            </text>
          </g>
        ))}

        {/* Capacity lines vary with root growth, so draw them as curves. */}
        <path d={path(() => true, (p) => p.taw)} fill="none" stroke="#ef4444" strokeWidth={1} strokeDasharray="4 3" />
        <path d={path(() => true, (p) => p.raw)} fill="none" stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 3" />

        {/* Actual depletion, then the projection. */}
        <path d={path(isActual, (p) => p.dr)} fill="none" stroke="#0284c7" strokeWidth={1.75} />
        {hasForecast && (
          <path
            d={path(isForecast, (p) => p.dr)}
            fill="none"
            stroke="#0284c7"
            strokeWidth={1.75}
            strokeDasharray="5 4"
            opacity={0.75}
          />
        )}

        {hasForecast && (
          <g>
            <line
              x1={x(firstForecast)}
              x2={x(firstForecast)}
              y1={PAD.t}
              y2={H - PAD.b}
              stroke="#94a3b8"
              strokeWidth={1}
            />
            <text x={x(firstForecast) + 3} y={PAD.t + 8} className="fill-gray-400 text-[9px]">
              today
            </text>
          </g>
        )}

        {crossing >= 0 && (
          <g>
            <circle cx={x(crossing)} cy={y(pts[crossing].dr)} r={3.5} fill="#ef4444" />
            <text
              x={Math.min(x(crossing) + 5, W - 70)}
              y={y(pts[crossing].dr) - 5}
              className="fill-red-600 text-[9px] font-medium"
            >
              needs water {pts[crossing].date.slice(5)}
            </text>
          </g>
        )}

        {pts.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={p.date} x={x(i)} y={H - 12} textAnchor="middle" className="fill-gray-400 text-[9px]">
              {p.date.slice(5)}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-sky-600" /> Depletion (mm)
        </span>
        {hasForecast && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-sky-600" /> Forecast
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-amber-500" /> RAW — irrigate at this line
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-red-500" /> TAW — stress beyond
        </span>
      </figcaption>
    </figure>
  )
}
