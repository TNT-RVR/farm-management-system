import { useMemo, useState } from 'react'
import { useBinLoads } from '@/lib/bin-loads'
import { useUsers } from '@/lib/queries'
import { driverName, scaleStats, type GroupBy } from '@/lib/weigh-scale'
import { cn } from '@/lib/utils'
import { TruckForecastCard } from './TruckForecast'

const kg = (v: number | null) => (v == null ? '—' : `${Math.round(v).toLocaleString('en-CA')} kg`)
const bu = (v: number) => `${Math.round(v).toLocaleString('en-CA')} bu`
const t = (v: number) => `${(v / 1000).toLocaleString('en-CA', { maximumFractionDigits: 1 })} t`

/**
 * The scale's figures by truck, trailer or driver (Sam, 23 Oct 2026: their
 * own tab, "Stats"): loads, kilograms, bushels, the average load and empty
 * weight, the heaviest load and the last day out.
 */
export function ScaleStatsTab({ cropYear }: { cropYear: number }) {
  const { data: loads } = useBinLoads()
  const { data: users } = useUsers()
  const [by, setBy] = useState<GroupBy>('truck')
  const [year, setYear] = useState<'this' | 'all'>('this')
  // The driver's name as the account reads today, not as the load stored it.
  const inYear = useMemo(() => {
    const nameOf = new Map((users ?? []).map((u) => [u.id, u.full_name]))
    return (loads ?? []).filter((l) => year === 'all' || l.crop_year === cropYear).map((l) => ({ ...l, driver: driverName(l, (id) => nameOf.get(id)) }))
  }, [loads, users, year, cropYear])
  const stats = useMemo(() => scaleStats(inYear, by), [inYear, by])
  const total = stats.reduce((s, x) => ({ loads: s.loads + x.loads, netKg: s.netKg + x.netKg, bushels: s.bushels + x.bushels }), { loads: 0, netKg: 0, bushels: 0 })
  const toggle = (on: boolean) => cn('px-3 py-1.5', on ? 'bg-brand-700 font-semibold text-white' : 'text-gray-600 hover:bg-gray-50')

  return (
    <div className="space-y-3 p-4 md:p-6">
      <TruckForecastCard cropYear={cropYear} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex overflow-hidden rounded-md border border-gray-300 bg-white text-sm">
          {(['truck', 'trailer', 'driver'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setBy(k)} className={cn(toggle(by === k), 'capitalize')}>
              {k}
            </button>
          ))}
        </span>
        <span className="inline-flex overflow-hidden rounded-md border border-gray-300 bg-white text-sm">
          <button type="button" onClick={() => setYear('this')} className={toggle(year === 'this')}>
            {cropYear}
          </button>
          <button type="button" onClick={() => setYear('all')} className={toggle(year === 'all')}>
            All years
          </button>
        </span>
        <span className="text-xs text-gray-500">
          {total.loads.toLocaleString('en-CA')} loads · {t(total.netKg)} · {bu(total.bushels)}
        </span>
      </div>

      {!stats.length ? (
        <p className="rounded-lg border border-gray-200 bg-white p-4 text-center text-sm text-gray-400">No loads weighed {year === 'this' ? `in ${cropYear}` : 'yet'}.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {stats.map((s) => (
            <li key={s.key} className="px-3 py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-semibold text-gray-900">{s.key}</span>
                <span className="text-sm tabular-nums text-gray-900">
                  <b>{s.loads}</b> load{s.loads === 1 ? '' : 's'} · <b>{kg(s.netKg)}</b> ({t(s.netKg)})
                </span>
              </div>
              <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-600">
                <span>{bu(s.bushels)}</span>
                {s.avgNetKg != null && <span>avg load {kg(s.avgNetKg)}</span>}
                {s.avgTareKg != null && <span>avg empty {kg(s.avgTareKg)}</span>}
                {s.maxGrossKg != null && <span>heaviest {kg(s.maxGrossKg)}</span>}
                {s.lastOn && <span>last {s.lastOn}</span>}
                {s.waiting > 0 && <span className="text-amber-700">{s.waiting} waiting to weigh out</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
