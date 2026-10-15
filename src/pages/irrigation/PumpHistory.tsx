import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { plcValue, usePlcHistory, usePlcTags } from '@/lib/plc'
import { cn } from '@/lib/utils'

/**
 * Totals, and the pressure trend.
 *
 * The panel has its own history screen. This one needs nothing from it: every
 * reading the agent takes is already stored, so the trend is drawn from data we
 * hold, over whatever window is asked for rather than whatever the panel's
 * buffer happens to keep.
 */
export function PumpHistory() {
  const [pump, setPump] = useState(1)
  const [hours, setHours] = useState(24)
  const { data: rows } = usePlcTags()
  const byTag = new Map((rows ?? []).map((r) => [r.tag, r]))
  const { data: series, isLoading } = usePlcHistory(`pump${pump}.local_psi`, hours)

  // Each turbine has its own totalizer (%MD192 and %MD392); there is no
  // station-wide one on the panel, so the pair is summed here.
  const t1 = byTag.get('pump1.gallons_total')
  const t2 = byTag.get('pump2.gallons_total')
  const nums = [t1, t2].map((r) => (r ? plcValue(r) : null)).filter((v): v is number => typeof v === 'number')
  const total = nums.length ? nums.reduce((a, b) => a + b, 0) : null
  const { data: s1 } = usePlcHistory('pump1.gallons_total', 24)
  const { data: s2 } = usePlcHistory('pump2.gallons_total', 24)
  const d1 = deltaToday(s1)
  const d2 = deltaToday(s2)
  const today = d1 == null && d2 == null ? null : (d1 ?? 0) + (d2 ?? 0)

  const points = (series ?? []).filter((p) => p.value != null) as { at: number; value: number }[]

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">Totals and history</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <Tile
          label="Pumped, all time"
          value={total == null ? '—' : compact(total)}
          sub="gallons · panel totalizer"
        />
        <Tile
          label="Today"
          value={today == null ? '—' : compact(today)}
          sub={today == null ? 'needs a day of readings' : 'gallons · since midnight'}
        />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-gray-900">
            Turbine {pump} pressure <span className="font-normal text-gray-400">last {hours} h</span>
          </h4>
          <div className="flex gap-1">
            {[1, 2].map((n) => (
              <button
                key={n}
                onClick={() => setPump(n)}
                className={cn(
                  'rounded px-2 py-0.5 text-[11px] font-medium',
                  pump === n ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                )}
              >
                T{n}
              </button>
            ))}
            {[24, 72, 168].map((h) => (
              <button
                key={h}
                onClick={() => setHours(h)}
                className={cn(
                  'rounded px-2 py-0.5 text-[11px] font-medium',
                  hours === h ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                )}
              >
                {h === 168 ? '7 d' : `${h} h`}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <p className="py-10 text-center text-xs text-gray-400">Loading…</p>
        ) : points.length < 2 ? (
          <p className="py-10 text-center text-xs text-gray-500">
            Not enough readings yet — the turbine panel isn&apos;t connected. A reading is kept whenever
            the pressure changes, so this fills in once it is.
          </p>
        ) : (
          <div className="mt-2 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <defs>
                  <linearGradient id="psiFade" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#15803d" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#15803d" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#f1f5f2" vertical={false} />
                <XAxis
                  dataKey="at"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(t) => new Date(t).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={40}
                />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={38} />
                <Tooltip
                  labelFormatter={(t) => new Date(Number(t)).toLocaleString('en-CA')}
                  formatter={(v) => [`${Math.round(Number(v))} PSI`, 'Pressure']}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                />
                <Area type="monotone" dataKey="value" stroke="#15803d" strokeWidth={2} fill="url(#psiFade)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-2xl font-semibold tabular-nums text-gray-900">{value}</p>
      <p className="text-[11px] text-gray-400">{sub}</p>
    </div>
  )
}

/**
 * Gallons since midnight, from the totalizer's own movement.
 *
 * Returns null rather than 0 when there is nothing from before midnight to
 * subtract — "0 gallons today" and "we have not been watching since midnight"
 * are different claims.
 */
function deltaToday(series: { at: number; value: number | null }[] | undefined): number | null {
  if (!series?.length) return null
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const before = series.filter((p) => p.at <= midnight.getTime() && p.value != null)
  const after = series.filter((p) => p.at > midnight.getTime() && p.value != null)
  if (!before.length || !after.length) return null
  return Math.max(0, after[after.length - 1].value! - before[before.length - 1].value!)
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  return n.toLocaleString('en-CA')
}
