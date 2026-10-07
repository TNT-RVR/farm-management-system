import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CalendarClock } from 'lucide-react'
import { useDryDown, type DryDown } from '@/lib/dry-down-data'

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
  if (!data || (!data.tests.length && !data.desiccatedOn)) return null
  const f = data.forecast

  return (
    <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <CalendarClock className="h-4 w-4 text-gray-400" /> {title ?? 'Dry-down prediction'}
          {title && data.cropName && <span className="font-normal text-gray-500">· {data.cropName}</span>}
        </h4>

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
            {data.learnedFrom === 'farm'
              ? `No ${data.cropName ?? 'crop'} readings to learn from yet, so this borrows the whole farm's: ${f.pairs} pair${f.pairs === 1 ? '' : 's'} of readings across every crop.`
              : `Learned only from this farm's ${data.cropName ?? ''} readings: ${f.pairs} pair${f.pairs === 1 ? '' : 's'}${data.learned ? ` on ${data.learned.fields} field${data.learned.fields === 1 ? '' : 's'}` : ''}.`}
            {f.rmse != null ? ` It misses them by ±${f.rmse.toFixed(1)} pts.` : ''}
            {f.pairs < 5 ? ' With few pairs it leans on a steady drying rate until wind, sun and dry air show their effect in the data.' : ''}
            {f.days.some((d) => d.unseen) ? ' Rain days it has never seen are held flat, not guessed — a test after the rain teaches it.' : ''}{' '}
            Weather: {data.station} ({data.stationKm} km) — temperature, humidity, wind, sunshine and rain.
            {data.humidityEstimated ? ' Some forecast humidity estimated from the overnight low.' : ''}
            {data.handTests ? ` ${data.handTests} hand-entered estimate${data.handTests === 1 ? '' : 's'} left out.` : ''}
          </p>
        </>
      ) : (
        <p className="mt-1.5 text-xs text-gray-600">{data.reason}</p>
      )}
    </div>
  )
}


/**
 * Tests as dots, the prediction as a dashed line with its likely range, the
 * crop's dry limit as a rule.
 *
 * Recharts at full width and a FIXED HEIGHT, the way every other chart in the
 * app is built (RainGraph, PriceChart: 150-420 px). The first version was a
 * hand-drawn SVG that kept its shape as it scaled, so it was taller than the
 * screen at full width and tiny when capped — chased twice before the rest of
 * the app showed the answer.
 *
 * Starts at the first test. The Reglone date is written above the chart, not
 * drawn on it: the days between the spray and the first sample were empty
 * axis that squeezed the part worth reading.
 */
function Chart({ data }: { data: DryDown }) {
  const f = data.forecast!
  const tests = data.tests.filter((t) => !data.desiccatedOn || t.date >= data.desiccatedOn)
  const last = data.tests.at(-1)!
  const ms = (d: string) => Date.parse(`${d}T12:00:00Z`)
  const byDate = new Map<number, { t: number; tested?: number; predicted?: number; range?: [number, number] }>()
  const row = (d: string) => {
    const t = ms(d)
    const r = byDate.get(t) ?? { t }
    byDate.set(t, r)
    return r
  }
  for (const x of tests) row(x.date).tested = x.pct
  // The prediction line starts at the last test so it joins the dots.
  row(last.date).predicted = last.pct
  row(last.date).range = [last.pct, last.pct]
  for (const d of f.days) {
    const r = row(d.date)
    r.predicted = Math.round(d.pct * 10) / 10
    r.range = [Math.round(d.low * 10) / 10, Math.round(d.high * 10) / 10]
  }
  const rows = [...byDate.values()].sort((a, b) => a.t - b.t)
  const top = Math.max(f.dryMax + 4, ...rows.flatMap((r) => [r.tested ?? 0, r.range?.[1] ?? 0]))
  const yMax = Math.ceil(top / 5) * 5
  const day = (t: number) => new Date(t).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })

  return (
    <div className="mt-2">
      {data.desiccatedOn && <p className="mb-1 text-[11px] text-gray-500">Reglone sprayed {fmt(data.desiccatedOn)}</p>}
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={day} tick={{ fontSize: 11 }} minTickGap={36} />
          <YAxis domain={[0, yMax]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} width={40} />
          <Tooltip
            labelFormatter={(t) => fmt(new Date(Number(t)).toISOString().slice(0, 10))}
            formatter={(v, name) =>
              Array.isArray(v) ? [`${v[0]}–${v[1]}%`, 'Likely range'] : [`${Number(v).toFixed(1)}%`, name as string]
            }
          />
          <ReferenceLine
            y={f.dryMax}
            stroke="#15803d"
            strokeDasharray="4 3"
            label={{ value: `dry ≤${f.dryMax}%`, position: 'insideBottomLeft', fontSize: 10, fill: '#15803d' }}
          />
          <Area dataKey="range" name="Likely range" stroke="none" fill="#2563eb" fillOpacity={0.12} isAnimationActive={false} connectNulls />
          <Line
            dataKey="predicted"
            name="Predicted afternoon"
            stroke="#2563eb"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={{ r: 3, fill: '#fff', strokeWidth: 1.5 }}
            isAnimationActive={false}
            connectNulls
          />
          <Line dataKey="tested" name="Tested" stroke="none" dot={{ r: 4, fill: '#111827', stroke: '#fff', strokeWidth: 1.5 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-0.5 flex gap-3 text-[10px] text-gray-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-gray-900" /> Tested
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0 w-3 border-t-2 border-dashed border-blue-600" /> Predicted afternoon moisture, with likely range
        </span>
      </div>
    </div>
  )
}
