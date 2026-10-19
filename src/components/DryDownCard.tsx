import { useEffect, useRef, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CalendarClock } from 'lucide-react'
import { useDryDown, useSetHarvestMethod, type DryDown } from '@/lib/dry-down-data'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { farmTz } from '@/lib/farm-context'

const fmt = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * When will it be dry? Under the field's moisture tests: what it read, what
 * it is predicted to read each afternoon for the next few days, and the first
 * day it should be at or under the crop's dry limit.
 */
export function DryDownCard({
  fieldId,
  cropYear,
  title,
}: {
  fieldId: string
  cropYear: number
  /** Shown in place of "Dry-down prediction" — the field's name, on the Moisture tab's list. */
  title?: React.ReactNode
}) {
  const { data } = useDryDown(fieldId, cropYear)
  const { profile } = useAuth()
  const setMethod = useSetHarvestMethod()
  if (!data || (!data.tests.length && !data.desiccatedOn)) return null
  const score = data.learned?.score
  const f = data.forecast

  return (
    <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <CalendarClock className="h-4 w-4 text-gray-400" /> {title ?? 'Dry-down prediction'}
          {title && data.cropName && <span className="font-normal text-gray-500">· {data.cropName}</span>}
        </h4>
        {/* A swath dries faster than a standing crop, so the model needs to know (9 Oct 2026). */}
        {data.planId && (
          <span className="flex overflow-hidden rounded-md border border-gray-300 text-[11px]" role="group" aria-label="Harvest method">
            {(['swathed', 'straight'] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={!hasManagerAccess(profile?.role) || setMethod.isPending}
                onClick={() => data.planId && m !== data.method && setMethod.mutate({ planId: data.planId, method: m })}
                className={cn('px-2 py-0.5', data.method === m && data.methodSet ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50 disabled:hover:bg-white')}
              >
                {m === 'swathed' ? 'Swathed' : 'Straight cut'}
              </button>
            ))}
          </span>
        )}

      </div>

      {f ? (
        <>
          <p className="mt-1.5 text-sm text-gray-800">
            {f.readyOn ? (
              f.readyOn === data.tests.at(-1)?.date ? (
                <>
                  <strong>Dry now</strong> — the last test was at or under {f.dryMax}%.
                </>
              ) : (
                <>
                  Likely dry (≤{f.dryMax}%) from <strong>{fmt(f.readyOn)}</strong> in the afternoon.
                </>
              )
            ) : (
              <>Not predicted to reach {f.dryMax}% in the next {f.days.length} days.</>
            )}
          </p>
          <Chart data={data} />
          <p className="mt-1 text-[11px] leading-snug text-gray-500">
            The crop dries towards what it would settle at in each afternoon&apos;s air and takes some back overnight ({data.emcSource}).{' '}
            {data.learnedFrom === 'start'
              ? `No ${data.cropName ?? 'crop'} meter readings to tune it yet, so this is a first guess from the weather; every pair of readings makes it better.`
              : `How fast it follows the air is tuned by ${f.pairs} pair${f.pairs === 1 ? '' : 's'} of this farm's readings${data.learned ? ` on ${data.learned.fields} field${data.learned.fields === 1 ? '' : 's'}` : ''}.`}
            {data.methodSet ? (data.method === 'swathed' ? ' Swathed, so it dries quicker.' : ' Straight cut.') : ' Swathed or straight cut is not set; it is treated as straight cut.'}
            {data.desiccatedOn ? ' Reglone speeds it up from the day it went on.' : ''}
            {f.days.some((d) => d.rain && d.forecast) ? ' Forecast rain makes the days after it less certain.' : ''}{' '}
            Weather: {data.station} ({data.stationKm} km){data.hourly ? ', hour by hour, scaled to the station’s own daily readings' : ''} — temperature, humidity, wind, sunshine and rain.
            {data.humidityEstimated ? ' Some forecast humidity estimated from the overnight low.' : ''}
            {data.handTests ? ` ${data.handTests} typed-in test${data.handTests === 1 ? '' : 's'} shown but not learned from.` : ''}
            {data.testerNotes.map((n) => ` ${n}`).join('')}
          </p>
          {score && (
            <p className="mt-1.5 rounded bg-white px-2 py-1 text-[11px] text-gray-700">
              <strong>Record:</strong> predicting each {data.cropName ?? ''} reading from the one before, it has been off by{' '}
              <strong>±{score.mae.toFixed(1)} pts</strong> on average over {score.n} reading{score.n === 1 ? '' : 's'}
              {score.n > 1 ? ` (the starting guess alone: ±${score.maeStart.toFixed(1)})` : ''}
              {Math.abs(score.bias) >= 0.5 ? `, usually ${score.bias > 0 ? 'wetter' : 'drier'} than the meter` : ''}.
            </p>
          )}
        </>
      ) : (
        <p className="mt-1.5 text-xs text-gray-600">{data.reason}</p>
      )}
    </div>
  )
}


/**
 * Tests as dots, the prediction as a dashed line with its likely range, the
 * crop's dry limit as a rule. By day: the readings and each afternoon for the
 * next 7 days. By hour: today, midnight to midnight, nights shaded (13 Oct 2026; before that the next 24 hours from now) (Sam,
 * 10 Oct 2026; 24 rather than 12 since 13 Oct, so a whole night and day show). The choice is remembered on the device.
 *
 * Recharts at full width and a FIXED HEIGHT, the way every other chart in the
 * app is built (RainGraph, PriceChart: 150-420 px). The first version was a
 * hand-drawn SVG that kept its shape as it scaled, so it was taller than the
 * screen at full width and tiny when capped — chased twice before the rest of
 * the app showed the answer.
 *
 * On a phone a tap on the chart shows that point's details and a tap
 * anywhere else hides them (10 Oct): the tooltip is held off once a press
 * lands outside the chart, and a mouse moving over it brings it back.
 *
 * Starts at the first test. The Reglone date is written above the chart, not
 * drawn on it: the days between the spray and the first sample were empty
 * axis that squeezed the part worth reading.
 */
const VIEW_KEY = 'drydown-chart-view'
type View = 'day' | 'hour'
const HOUR = 3_600_000
const DAY = 86_400_000

function hourLabel(h: number) {
  if (h === 0) return '12 am'
  if (h < 12) return `${h} am`
  if (h === 12) return '12 pm'
  return `${h - 12} pm`
}

function Chart({ data }: { data: DryDown }) {
  const f = data.forecast!
  const [view, setViewState] = useState<View>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'hour' ? 'hour' : 'day'
    } catch {
      return 'day'
    }
  })
  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* private window: not remembered */
    }
  }
  const hourly = view === 'hour' && (f.hourly?.length ?? 0) > 0
  // This hour on the farm, on the chart's clock (farm time written as UTC).
  const [now] = useState(() => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: farmTz(), year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date())
    const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00'
    return { ms: Date.parse(`${v('year')}-${v('month')}-${v('day')}T${v('hour').padStart(2, '0')}:00:00Z`), date: `${v('year')}-${v('month')}-${v('day')}` }
  })
  const weekOut = new Date(Date.parse(`${now.date}T12:00:00Z`) + 7 * DAY).toISOString().slice(0, 10)

  // The tooltip: shown while the chart is touched or hovered, hidden by a press anywhere else.
  const wrap = useRef<HTMLDivElement>(null)
  const [tipOn, setTipOn] = useState(true)
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setTipOn(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [])

  const tests = data.tests.filter((t) => !data.desiccatedOn || t.date >= data.desiccatedOn)
  const last = data.tests.at(-1)!
  const msDay = (d: string) => Date.parse(`${d}T12:00:00Z`)
  const msHour = (d: string, h: number) => Date.parse(`${d}T00:00:00Z`) + h * HOUR
  const byT = new Map<number, { t: number; tested?: number; predicted?: number; range?: [number, number] }>()
  const row = (t: number) => {
    const r = byT.get(t) ?? { t }
    byT.set(t, r)
    return r
  }
  const r1 = (v: number) => Math.round(v * 10) / 10
  const dayStart = Date.parse(`${now.date}T00:00:00Z`)
  if (hourly) {
    // Today, midnight to midnight; a reading taken today still shows.
    const inWindow = (t: number) => t >= dayStart && t <= dayStart + 24 * HOUR
    for (const x of tests) if (inWindow(msHour(x.date, x.hour))) row(msHour(x.date, x.hour)).tested = x.pct
    if (inWindow(msHour(last.date, last.hour))) {
      const start = row(msHour(last.date, last.hour))
      start.predicted = last.pct
      start.range = [last.pct, last.pct]
    }
    for (const h of f.hourly) {
      const t = msHour(h.date, h.hour)
      if (!inWindow(t)) continue
      const r = row(t)
      r.predicted = r1(h.pct)
      r.range = [r1(h.low), r1(h.high)]
    }
  } else {
    for (const x of tests) row(msDay(x.date)).tested = x.pct
    // The prediction line starts at the last test so it joins the dots.
    const start = row(msDay(last.date))
    start.predicted = last.pct
    start.range = [last.pct, last.pct]
    for (const d of f.days) {
      if (d.date > weekOut) continue
      const r = row(msDay(d.date))
      r.predicted = r1(d.pct)
      r.range = [r1(d.low), r1(d.high)]
    }
  }
  const rows = [...byT.values()].sort((a, b) => a.t - b.t)
  const top = Math.max(f.dryMax + 4, ...rows.flatMap((r) => [r.tested ?? 0, r.range?.[1] ?? 0]))
  const yMax = Math.ceil(top / 5) * 5
  const day = (t: number) => new Date(t).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const when = (t: number) => {
    const d = new Date(t)
    const date = d.toLocaleDateString('en-CA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    return hourly ? `${date}, ${hourLabel(d.getUTCHours())}` : date
  }
  // By hour: the whole day on the axis, a tick every two hours, and the nights (6 pm to 8 am) shaded.
  const first = hourly ? dayStart : (rows[0]?.t ?? 0)
  const lastT = hourly ? dayStart + 24 * HOUR : (rows.at(-1)?.t ?? 0)
  const midnights: number[] = []
  const nights: [number, number][] = []
  if (hourly) {
    for (let t = first; t <= lastT; t += 2 * HOUR) midnights.push(t)
    for (let t = Math.floor(first / DAY) * DAY - 6 * HOUR; t < lastT; t += DAY) {
      const a = Math.max(first, t)
      const b = Math.min(lastT, t + 14 * HOUR)
      if (b > a) nights.push([a, b])
    }
  }

  return (
    <div className="mt-2">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-gray-500">{data.desiccatedOn ? `Reglone sprayed ${fmt(data.desiccatedOn)}` : ''}</span>
        <span className="flex overflow-hidden rounded-md border border-gray-300 text-[11px]" role="group" aria-label="Show by">
          {(['day', 'hour'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={cn('px-2 py-0.5', view === v ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}
            >
              By {v}
            </button>
          ))}
        </span>
      </div>
      <div ref={wrap} onPointerDown={() => setTipOn(true)} onPointerMove={(e) => e.pointerType === 'mouse' && setTipOn(true)}>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
            {nights.map(([a, b]) => (
              <ReferenceArea key={a} x1={a} x2={b} fill="#0f172a" fillOpacity={0.05} stroke="none" ifOverflow="hidden" />
            ))}
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={hourly ? [first, lastT] : ['dataMin', 'dataMax']}
              ticks={hourly ? midnights : undefined}
              tickFormatter={hourly ? (t: number) => hourLabel(new Date(t).getUTCHours()) : day}
              tick={{ fontSize: 11 }}
              minTickGap={hourly ? 4 : 36}
            />
            <YAxis domain={[0, yMax]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} width={40} />
            <Tooltip
              active={tipOn ? undefined : false}
              labelFormatter={(t) => when(Number(t))}
              formatter={(v, name) => (Array.isArray(v) ? [`${v[0]}–${v[1]}%`, 'Likely range'] : [`${Number(v).toFixed(1)}%`, name as string])}
            />
            <ReferenceLine
              y={f.dryMax}
              stroke="#15803d"
              strokeDasharray="4 3"
              label={{ value: `dry ≤${f.dryMax}%`, position: 'insideBottomLeft', fontSize: 10, fill: '#15803d' }}
            />
            {/* Where we are: today on the day chart, this hour on the hour chart. */}
            <ReferenceLine
              x={hourly ? now.ms : msDay(now.date)}
              stroke="#dc2626"
              strokeWidth={1.5}
              ifOverflow="hidden"
              label={{ value: hourly ? 'now' : 'today', position: 'insideTopRight', fontSize: 10, fill: '#dc2626' }}
            />
            <Area dataKey="range" name="Likely range" stroke="none" fill="#2563eb" fillOpacity={0.12} isAnimationActive={false} connectNulls />
            <Line
              dataKey="predicted"
              name={hourly ? 'Predicted' : 'Predicted afternoon'}
              stroke="#2563eb"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={hourly ? false : { r: 3, fill: '#fff', strokeWidth: 1.5 }}
              isAnimationActive={false}
              connectNulls
            />
            <Line dataKey="tested" name="Tested" stroke="none" dot={{ r: 4, fill: '#111827', stroke: '#fff', strokeWidth: 1.5 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-gray-900" /> Tested
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0 w-3 border-t-2 border-dashed border-blue-600" />
          {hourly ? 'Predicted moisture today, midnight to midnight' : 'Predicted afternoon moisture, next 7 days'}, with likely range
        </span>
        {hourly && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm bg-slate-900/10" /> Night, 6 pm to 8 am
          </span>
        )}
      </div>
    </div>
  )
}
