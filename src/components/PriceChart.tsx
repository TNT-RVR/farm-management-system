import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MarketPoint, MarketSeries } from '@/lib/markets'

/**
 * Several price series on one time axis.
 *
 * Rows are keyed by date and each series gets its own column, so recharts draws
 * a real gap where a series has no observation rather than joining across it.
 * That gap is information: a monthly farm-gate series and a weekly elevator bid
 * genuinely do not have points on the same days, and pretending otherwise would
 * draw a straight line through four decades of missing weeks.
 *
 * Zoom: the scroll wheel over the chart, or a two-finger pinch on a phone,
 * narrows the span around the pointer; a double tap or click puts it back.
 * Done on the row index rather than the date so a sparse series zooms as
 * smoothly as a dense one.
 */
export const CHART_COLOURS = ['#0f766e', '#c2410c', '#4338ca', '#b91c1c', '#0369a1', '#7c3aed', '#a16207', '#be185d']

export function PriceChart({
  series,
  points,
  unit,
  height = 260,
  scale = 1,
  currency = true,
  colourOf,
  legend = true,
  connectGaps = false,
}: {
  series: MarketSeries[]
  points: MarketPoint[]
  /** The unit the chart is DRAWN in, after `scale`. Shown on the axis. */
  unit: string
  height?: number
  /**
   * Multiplier applied to every value before drawing.
   *
   * Exists for cattle: the review quotes $/cwt, so a 500-600 lb steer plots at
   * 657 — a number in the same range as the weight class naming its own series,
   * and heavier classes plot LOWER because lighter cattle are dearer per pound.
   * The two together read as though weight and price had been swapped. Drawn in
   * $/lb instead, 6.58 cannot be mistaken for a weight.
   */
  scale?: number
  /**
   * Whether the values are money.
   *
   * The fertilizer tab draws a price INDEX, where 143.8 is not $143.80 and a
   * dollar sign on the axis makes it look like a per-tonne price it is not.
   */
  currency?: boolean
  /** A fixed colour per series id, so tiles elsewhere can match the lines. */
  colourOf?: (seriesId: string, index: number) => string
  legend?: boolean
  /**
   * Draw through a missing point. Right for one weekly series that skipped
   * a week; wrong for mixed frequencies, where the gap is the information.
   */
  connectGaps?: boolean
}) {
  const { rows, keys } = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>()
    const used = new Set<string>()
    for (const p of points) {
      if (p.value == null) continue
      const s = series.find((x) => x.id === p.series_id)
      if (!s) continue
      used.add(s.id)
      const row = byDate.get(p.observed_on) ?? { on: p.observed_on }
      row[s.id] = p.value * scale
      byDate.set(p.observed_on, row)
    }
    return {
      rows: [...byDate.values()].sort((a, b) => String(a.on).localeCompare(String(b.on))),
      keys: series.filter((s) => used.has(s.id)),
    }
  }, [series, points, scale])

  // The visible span, as a fraction of the rows: [0, 1] is everything. Kept
  // with the row count it was set for, so new data resets the zoom without
  // an effect.
  const [winState, setWinState] = useState<{ n: number; win: [number, number] }>({ n: rows.length, win: [0, 1] })
  const win: [number, number] = winState.n === rows.length ? winState.win : [0, 1]
  const setWin = (next: [number, number] | ((w: [number, number]) => [number, number])) =>
    setWinState((s) => {
      const cur: [number, number] = s.n === rows.length ? s.win : [0, 1]
      return { n: rows.length, win: typeof next === 'function' ? next(cur) : next }
    })
  const box = useRef<HTMLDivElement>(null)
  const pinch = useRef<{ dist: number; win: [number, number]; mid: number } | null>(null)

  const zoomAt = (frac: number, factor: number) => {
    setWin(([a, b]) => {
      const span = b - a
      const minSpan = Math.min(1, 4 / Math.max(rows.length, 1))
      const next = Math.max(minSpan, Math.min(1, span * factor))
      // Keep the point under the pointer where it is.
      const at = a + frac * span
      let na = at - frac * next
      let nb = na + next
      if (na < 0) {
        nb -= na
        na = 0
      }
      if (nb > 1) {
        na -= nb - 1
        nb = 1
      }
      return [Math.max(0, na), Math.min(1, nb)]
    })
  }

  // The wheel needs a non-passive listener to stop the page scrolling under
  // the chart; React's onWheel is passive and cannot.
  useEffect(() => {
    const el = box.current
    if (!el || rows.length < 6) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
      zoomAt(frac, e.deltaY > 0 ? 1.25 : 0.8)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length])

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 2 || !box.current) return
    const [t1, t2] = [e.touches[0], e.touches[1]]
    const r = box.current.getBoundingClientRect()
    pinch.current = {
      dist: Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY),
      win,
      mid: Math.max(0, Math.min(1, ((t1.clientX + t2.clientX) / 2 - r.left) / r.width)),
    }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 2 || !pinch.current) return
    const [t1, t2] = [e.touches[0], e.touches[1]]
    const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
    const factor = pinch.current.dist / Math.max(dist, 1)
    const [a, b] = pinch.current.win
    const span = b - a
    const minSpan = Math.min(1, 4 / Math.max(rows.length, 1))
    const next = Math.max(minSpan, Math.min(1, span * factor))
    const at = a + pinch.current.mid * span
    let na = at - pinch.current.mid * next
    let nb = na + next
    if (na < 0) {
      nb -= na
      na = 0
    }
    if (nb > 1) {
      na -= nb - 1
      nb = 1
    }
    setWin([Math.max(0, na), Math.min(1, nb)])
  }
  const onTouchEnd = () => {
    pinch.current = null
  }

  const shown = useMemo(() => {
    if (win[0] === 0 && win[1] === 1) return rows
    const a = Math.floor(win[0] * rows.length)
    const b = Math.max(a + 2, Math.ceil(win[1] * rows.length))
    return rows.slice(a, b)
  }, [rows, win])
  const zoomed = win[0] !== 0 || win[1] !== 1

  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-gray-400">Nothing recorded for this span.</p>
  }

  const colour = (s: MarketSeries, i: number) => colourOf?.(s.id, i) ?? CHART_COLOURS[i % CHART_COLOURS.length]

  return (
    <div className="mt-3">
      <div
        ref={box}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onDoubleClick={() => setWin([0, 1])}
        style={{ touchAction: 'pan-y' }}
        className="relative"
      >
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={shown} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="on"
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickFormatter={(v: string) => (zoomed && shown.length < 40 ? v.slice(5) : v.slice(0, 7))}
              minTickGap={40}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              width={62}
              domain={['auto', 'auto']}
              // Rounding to whole dollars turns $6.58/lb into "$7" and loses the
              // whole point of the axis. Decimals wherever the numbers are small.
              tickFormatter={(v: number) => {
                // Cents matter on a $/lb axis and never on an index, where the
                // zero tick was rendering as "0.00".
                if (!currency) return Number.isInteger(v) ? String(v) : v.toFixed(1)
                return v < 20 ? `$${v.toFixed(2)}` : `$${Math.round(v)}`
              }}
              label={{
                value: unit,
                angle: -90,
                position: 'insideLeft',
                style: { fontSize: 11, fill: '#94a3b8' },
              }}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}
              formatter={(v, name) => [
                `${Number(v).toLocaleString('en-CA', {
                  maximumFractionDigits: Number(v) < 20 ? 3 : 2,
                })} ${unit}`,
                keys.find((k) => k.id === name)?.name ?? String(name),
              ]}
            />
            {keys.map((s, i) => (
              <Line
                key={s.id}
                type="monotone"
                dataKey={s.id}
                stroke={colour(s, i)}
                strokeWidth={s.source === 'statcan' ? 1.6 : 2.4}
                dot={false}
                // Gaps stay gaps unless asked. See the note at the top of this file.
                connectNulls={connectGaps}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        {zoomed && (
          <button
            type="button"
            onClick={() => setWin([0, 1])}
            className="absolute right-2 top-1 rounded border border-gray-200 bg-white/90 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-white"
          >
            reset zoom
          </button>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-600">
        {legend &&
          keys.map((s, i) => (
            <span key={s.id} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-3 rounded-sm" style={{ background: colour(s, i) }} />
              {s.name}
            </span>
          ))}
        {rows.length >= 6 && (
          <span className="ml-auto text-[10px] text-gray-400">scroll or pinch to zoom · double-tap to reset</span>
        )}
      </div>
    </div>
  )
}
