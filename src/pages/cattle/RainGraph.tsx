import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useWheelZoom } from '@/lib/useWheelZoom'

// Forage-yield band edges (mm) — drawn as reference lines so you can see which
// grass-production tier this year's rain is tracking toward.
const BANDS = [
  { mm: 250, label: 'Fair 250' },
  { mm: 350, label: 'Good 350' },
  { mm: 450, label: 'Excellent 450' },
  { mm: 550, label: '550' },
  { mm: 650, label: '650' },
]

/**
 * Cumulative growing-season rainfall (running total mm) with daily bars, and
 * the 10-year average running total to the same day when it is known — so a
 * dry year reads as a gap between two lines, not a number to remember.
 */
export function RainGraph({
  series,
  normal,
}: {
  series: { t: string; mm: number }[]
  normal?: { md: string; mm: number }[]
}) {
  const avgByMd = new Map((normal ?? []).map((n) => [n.md, n.mm]))
  const data = series.reduce<{ ms: number; cum: number; daily: number; avg: number | null }[]>((arr, p) => {
    const prev = arr.length ? arr[arr.length - 1].cum : 0
    arr.push({
      ms: new Date(p.t + 'T12:00:00Z').getTime(),
      cum: Math.round((prev + p.mm) * 10) / 10,
      daily: p.mm,
      avg: avgByMd.get(p.t.slice(5)) ?? null,
    })
    return arr
  }, [])
  const total = data.length ? data[data.length - 1].cum : 0
  const maxY = Math.max(350, Math.ceil(total / 50) * 50 + 50)
  const bands = BANDS.filter((b) => b.mm <= maxY)
  const dataMin = data.length ? data[0].ms : NaN
  const dataMax = data.length ? data[data.length - 1].ms : NaN
  const { attach, domain, reset, zoomed } = useWheelZoom(dataMin, dataMax)

  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

  return (
    <div ref={attach} className="relative">
      {zoomed && (
        <button
          onClick={reset}
          className="absolute right-1 top-0 z-10 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
        >
          Reset zoom
        </button>
      )}
      <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
        <XAxis
          dataKey="ms"
          type="number"
          domain={domain ?? ['dataMin', 'dataMax']}
          allowDataOverflow
          scale="time"
          tickFormatter={fmtDate}
          tick={{ fontSize: 11 }}
          minTickGap={44}
        />
        <YAxis
          yAxisId="cum"
          domain={[0, maxY]}
          tick={{ fontSize: 11 }}
          label={{ value: 'cumulative mm', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
        />
        <YAxis yAxisId="daily" orientation="right" tick={{ fontSize: 11 }} label={{ value: 'daily mm', angle: 90, position: 'insideRight', style: { fontSize: 11 } }} />
        <Tooltip
          labelFormatter={(ms) => new Date(Number(ms)).toLocaleDateString('en-CA')}
          formatter={(v, name) => [`${Number(v).toFixed(1)} mm`, name as string]}
        />
        {bands.map((b) => (
          <ReferenceLine
            key={b.mm}
            yAxisId="cum"
            y={b.mm}
            stroke="#cbd5e1"
            strokeDasharray="4 3"
            label={{ value: b.label, fontSize: 9, fill: '#94a3b8', position: 'insideRight' }}
          />
        ))}
        <Bar yAxisId="daily" dataKey="daily" name="Daily" fill="#bae6fd" />
        <Area yAxisId="cum" type="monotone" dataKey="cum" name="This year" stroke="#0369a1" fill="#e0f2fe" strokeWidth={2} dot={false} />
        {avgByMd.size > 0 && (
          <Line yAxisId="cum" type="monotone" dataKey="avg" name="10-year average" stroke="#64748b" strokeDasharray="5 4" strokeWidth={1.5} dot={false} connectNulls />
        )}
      </ComposedChart>
    </ResponsiveContainer>
    </div>
  )
}
