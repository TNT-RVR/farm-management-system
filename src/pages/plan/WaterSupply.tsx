import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, LineChart as LineIcon } from 'lucide-react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Modal } from '@/components/Modal'
import { supabase } from '@/lib/supabase'
import { SECTION_LABEL, WATER_STATIONS, pageHref, type WaterStation } from '@/lib/water-stations'
import { cn } from '@/lib/utils'

type Row = { station: string; observed_on: string; value: number | string | null; pct_full: number | string | null; pct_full_last_year: number | string | null; pct_of_median: number | string | null }

const md = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
const r0 = (v: number | string | null | undefined) => (v == null ? '—' : Math.round(Number(v)).toLocaleString('en-CA'))

/**
 * Reservoirs and snowpacks, in the two systems the farm draws from — the
 * Oldman River for the river licences, SMRID's canals for the rest — each with
 * a graph (this water year against last, and the median for the SNOTEL sites)
 * and links to where the number comes from.
 */
export function WaterSupplyList({ rows }: { rows: Row[] }) {
  const [graph, setGraph] = useState<WaterStation | null>(null)
  const latest = new Map(rows.map((r) => [r.station, r]))
  return (
    <div className="space-y-2">
      {(['canals', 'oldman'] as const).map((section) => (
        <div key={section}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{SECTION_LABEL[section]}</p>
          <ul className="mt-0.5 divide-y divide-gray-100">
            {WATER_STATIONS.filter((s) => s.section === section).map((s) => {
              const r = latest.get(s.key)
              const v = r?.value == null ? null : Number(r.value)
              const ly = r?.pct_full_last_year == null ? null : Number(r.pct_full_last_year)
              return (
                <li key={s.key} className="flex flex-wrap items-baseline gap-x-2 py-1">
                  <span className="min-w-0 flex-1">
                    <b>{s.name}</b>
                    {s.note && <span className="text-gray-400"> · {s.note}</span>}
                    <span className="block text-gray-600">
                      {!r ? (
                        <span className="text-gray-400">no reading yet</span>
                      ) : s.kind === 'reservoir' ? (
                        <>
                          {r0(v)}% full
                          {ly != null && v != null && (
                            <span className={cn(v < ly - 10 ? 'text-red-700' : v > ly + 10 ? 'text-green-700' : 'text-gray-500')}> (this date last year {r0(ly)}%)</span>
                          )}
                        </>
                      ) : v != null && v > 0.5 ? (
                        <>
                          {r0(v)} mm of water in the snow
                          {r.pct_of_median != null && <span className={cn(Number(r.pct_of_median) < 80 ? 'text-red-700' : 'text-gray-500')}> · {r0(r.pct_of_median)}% of median</span>}
                        </>
                      ) : (
                        'no snow yet'
                      )}
                      {r && <span className="text-gray-400"> · {md(r.observed_on)}</span>}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <button type="button" onClick={() => setGraph(s)} className="inline-flex items-center gap-0.5 text-sky-700 hover:underline">
                      <LineIcon className="h-3 w-3" /> Graph
                    </button>
                    <a href={pageHref(s)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-sky-700 hover:underline" title={s.pageUrl}>
                      Source <ExternalLink className="h-3 w-3" />
                    </a>
                    <a href={s.dataUrl} target="_blank" rel="noreferrer" className="text-gray-400 hover:underline" title="The feed the app reads">
                      data
                    </a>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      {graph && <WaterGraph station={graph} onClose={() => setGraph(null)} />}
    </div>
  )
}

/** Days since 1 October — the water year, when snow starts to build. */
const wyDay = (iso: string) => {
  const d = new Date(iso + 'T12:00:00')
  const y = d.getMonth() >= 9 ? d.getFullYear() : d.getFullYear() - 1
  return { wy: y, day: Math.round((d.getTime() - new Date(y, 9, 1, 12).getTime()) / 86_400_000) }
}
const MONTHS = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']

function WaterGraph({ station, onClose }: { station: WaterStation; onClose: () => void }) {
  const today = wyDay(new Date().toISOString().slice(0, 10))
  const since = `${today.wy - 1}-10-01`
  const { data, isLoading } = useQuery({
    queryKey: ['water_supply_daily', station.key, since],
    queryFn: async () => {
      const { data: rows, error } = await supabase.from('water_supply_daily').select('day, value, median').eq('station', station.key).gte('day', since).order('day').limit(1000)
      if (error) throw error
      return rows as { day: string; value: number | null; median: number | null }[]
    },
  })
  const series = useMemo(() => {
    const out = Array.from({ length: 366 }, (_, i) => ({ day: i, thisYear: null as number | null, lastYear: null as number | null, median: null as number | null }))
    for (const r of data ?? []) {
      const w = wyDay(r.day)
      if (w.day < 0 || w.day > 365) continue
      const slot = out[w.day]
      if (w.wy === today.wy) slot.thisYear = r.value == null ? null : Number(r.value)
      else if (w.wy === today.wy - 1) slot.lastYear = r.value == null ? null : Number(r.value)
      if (r.median != null && slot.median == null) slot.median = Number(r.median)
    }
    return out
  }, [data, today.wy])
  const hasMedian = series.some((s) => s.median != null)
  const label = (d: number) => {
    const t = new Date(today.wy, 9, 1 + d)
    return t.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
  }
  return (
    <Modal title={station.name} onClose={onClose} wide>
      <p className="mb-2 text-xs text-gray-500">
        {station.kind === 'reservoir' ? 'Percent full' : 'Snow water equivalent, mm'} — the water year from 1 October: {today.wy}–{String(today.wy + 1).slice(2)} against {today.wy - 1}–{String(today.wy).slice(2)}
        {hasMedian ? ', and the median for the date' : ''}.
      </p>
      {isLoading ? (
        <p className="py-10 text-center text-sm text-gray-400">Loading…</p>
      ) : !(data ?? []).length ? (
        <p className="py-10 text-center text-sm text-gray-400">No history stored yet — it fills in from the daily pull.</p>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <LineChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="day" type="number" domain={[0, 365]} ticks={MONTHS.map((_, i) => Math.round(i * 30.4))} tickFormatter={(d: number) => MONTHS[Math.min(11, Math.round(d / 30.4))]} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={40} unit={station.kind === 'reservoir' ? '%' : ''} />
              <Tooltip labelFormatter={(d) => label(Number(d))} formatter={(v) => (v == null ? '—' : `${Math.round(Number(v))}${station.kind === 'reservoir' ? '%' : ' mm'}`)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line dataKey="thisYear" name={`${today.wy}–${String(today.wy + 1).slice(2)}`} stroke="#0369a1" strokeWidth={2} dot={false} connectNulls />
              <Line dataKey="lastYear" name={`${today.wy - 1}–${String(today.wy).slice(2)}`} stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
              {hasMedian && <Line dataKey="median" name="Median" stroke="#d97706" strokeWidth={1} dot={false} connectNulls />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-2 text-[11px] text-gray-400">
        From{' '}
        <a href={pageHref(station)} target="_blank" rel="noreferrer" className="text-sky-700 underline">
          {station.source === 'wiski' ? `Alberta Rivers, station ${station.key}` : `NRCS SNOTEL ${station.key}`}
        </a>{' '}
        (
        <a href={station.dataUrl} target="_blank" rel="noreferrer" className="underline">
          the feed
        </a>
        ), daily means stored each morning.
      </p>
    </Modal>
  )
}
