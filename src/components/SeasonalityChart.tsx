import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Seasonal } from '@/lib/markets'

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * How each month usually compares to its own year.
 *
 * Above the line the month is dearer than that year's average, below it cheaper.
 * The point is to see the seasonal low BEFORE sitting in it, which is the one
 * thing a price chart of raw dollars will not show you.
 */
export function SeasonalityChart({ rows }: { rows: Seasonal[] }) {
  const data = rows.map((r) => ({ ...r, name: MONTHS[r.month] }))
  return (
    <div className="mt-3">
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
          <YAxis
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            width={44}
            tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}%`}
          />
          <ReferenceLine y={0} stroke="#64748b" />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}
            formatter={(v, _n, p) => {
              const n = Number(v)
              return [
                `${n > 0 ? '+' : ''}${n.toFixed(1)}% vs the year's average`,
                `${(p?.payload as Seasonal | undefined)?.n ?? 0} observations`,
              ]
            }}
          />
          <Bar dataKey="avg" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.month} fill={d.avg >= 0 ? '#0f766e' : '#c2410c'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
