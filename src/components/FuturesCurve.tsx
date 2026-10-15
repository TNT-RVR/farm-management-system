import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useFuturesCurve, type MarketSeries } from '@/lib/markets'

const monthLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  })

/**
 * One forward curve, as quoted on a single day.
 *
 * Deliberately not blended across weeks: a curve is a snapshot of what the
 * market would pay today for delivery later, and mixing two dates into one line
 * would draw a shape the market never actually had.
 */
export function FuturesCurve({ series }: { series: MarketSeries }) {
  const { data, isLoading } = useFuturesCurve(series.id)
  if (isLoading) return <p className="text-xs text-gray-400">Loading {series.name}…</p>
  if (!data || data.points.length === 0) return null

  const rows = data.points.map((p) => ({ on: monthLabel(p.contract_month), value: p.value }))
  const first = rows[0]?.value
  const last = rows.at(-1)?.value
  const carry = first != null && last != null ? last - first : null

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <p className="text-sm font-medium text-gray-800">{series.name}</p>
        <span className="text-[11px] text-gray-400">quoted {data.quoteOn}</span>
        {carry != null && (
          <span
            className={`ml-auto text-xs tabular-nums ${carry >= 0 ? 'text-green-700' : 'text-red-700'}`}
            title="Difference between the nearest and furthest contract on the curve"
          >
            {carry >= 0 ? '+' : ''}
            {carry.toFixed(2)} {series.unit} across the curve
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="on" tick={{ fontSize: 11, fill: '#94a3b8' }} />
          <YAxis
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            width={56}
            domain={['dataMin - 5', 'dataMax + 5']}
            tickFormatter={(v: number) => v.toFixed(v < 20 ? 2 : 0)}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}
            formatter={(v) => [`${Number(v)} ${series.unit}`, series.commodity]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#4338ca"
            strokeWidth={2.2}
            dot={{ r: 3 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
