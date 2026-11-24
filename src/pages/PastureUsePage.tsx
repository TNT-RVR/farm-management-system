import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Page } from '@/components/Page'
import { PillTabs } from '@/components/PillTabs'
import { YearSelect } from '@/components/YearSelect'
import { ExportButton } from '@/components/ExportButton'
import { useRanches } from '@/lib/ranches'
import { localToday } from '@/lib/today'
import { n0 } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CARD_HEAD, TABLE_HEAD } from '@/lib/table-style'
import { reportCsv, reportTable } from '@/lib/reports/framework'
import { downloadBlob, tableReportToPdf } from '@/lib/table-report'
import { keepMadeReport } from '@/lib/made-reports'
import { fetchPastureUse, longDay, pastureUse, pastureUseReport, type PastureUseView } from '@/lib/reports/pasture-use'

/*
 * Which herd was in which pasture over a year, and for how long (Sam,
 * 23 Nov 2026). The arithmetic and its rules are in lib/reports/pasture-use;
 * the Reports page makes the same file.
 */

// The same remembered choice as the cattle pages' Ranch picker.
const RANCH_STORE_KEY = 'cattle_ranch_id'
const readStore = () => {
  try {
    return localStorage.getItem(RANCH_STORE_KEY)
  } catch {
    return null
  }
}

const VIEWS = [
  { key: 'herd', label: 'By herd' },
  { key: 'pasture', label: 'By pasture' },
] as const

const day = longDay
const nights = (n: number) => `${n0(n)} day${n === 1 ? '' : 's'}`

export function PastureUsePage() {
  const today = localToday()
  const thisYear = Number(today.slice(0, 4))
  const [params, setParams] = useSearchParams()
  const year = Number(params.get('year')) || thisYear
  const view: PastureUseView = params.get('view') === 'pasture' ? 'pasture' : 'herd'
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    next.set(k, v)
    setParams(next, { replace: true })
  }

  const { data: ranches } = useRanches()
  const [pref, setPref] = useState<string>(() => params.get('ranch') ?? readStore() ?? '')
  const ranchId = pref && ranches?.some((r) => r.id === pref) ? pref : ''
  const pickRanch = (id: string) => {
    setPref(id)
    try {
      localStorage.setItem(RANCH_STORE_KEY, id)
    } catch {
      // Blocked storage: the choice holds for this visit.
    }
  }

  const { data, isLoading, error } = useQuery({ queryKey: ['pasture-use'], queryFn: fetchPastureUse, staleTime: 5 * 60_000 })
  const result = useMemo(
    () => (data ? pastureUse({ ...data, year, today, nowIso: new Date().toISOString(), ranchId: ranchId || null }) : null),
    [data, year, today, ranchId],
  )
  const years = useMemo(() => {
    const ys = new Set<number>([thisYear, year])
    for (const a of data?.activations ?? []) ys.add(Number(a.started_at.slice(0, 4)))
    return [...ys].sort((a, b) => b - a)
  }, [data, thisYear, year])
  const ranchName = ranchId ? (ranches?.find((r) => r.id === ranchId)?.name ?? 'one ranch') : 'All ranches'

  const exportAs = async (format: 'CSV' | 'PDF') => {
    if (!result?.herds.length) throw new Error('Nothing to export for this year.')
    const report = pastureUseReport(result, { view, year, ranchName })
    const blob = format === 'CSV' ? new Blob([reportCsv(report)], { type: 'text/csv' }) : await tableReportToPdf(reportTable(report))
    const filename = `${report.filename}.${format.toLowerCase()}`
    downloadBlob(blob, filename)
    keepMadeReport({ reportId: 'pasture-use', name: 'Pasture use by herd', blob, filename, format, params: { year: String(year), ranch: ranchId ?? '', view }, labels: { Year: String(year), Ranch: ranchName, 'Laid out': view === 'herd' ? 'By herd' : 'By pasture' }, family: 'grazing-report' })
  }

  const picker = (
    <div className="flex flex-wrap items-center gap-2">
      <YearSelect value={year} years={years} onChange={(y) => set('year', String(y))} size="sm" />
      <div className="flex flex-wrap rounded-md border border-gray-200 bg-white p-0.5">
        {[{ id: '', name: 'All' }, ...(ranches ?? [])].map((r) => (
          <button
            key={r.id || 'all'}
            type="button"
            onClick={() => pickRanch(r.id)}
            aria-pressed={r.id === ranchId}
            className={cn('rounded px-3 py-1 text-sm font-medium transition-colors', r.id === ranchId ? 'bg-brand-700 text-white' : 'text-gray-600 hover:bg-gray-50')}
          >
            {r.name}
          </button>
        ))}
      </div>
      <ExportButton onExport={exportAs} label="Export pasture use" />
    </div>
  )

  return (
    <Page
      title="Pasture use"
      info={
        <>
          {result && <p>{result.herds.length} herds · {result.pastures.length} pastures used in {year}</p>}
          <p>Which herd was in which pasture, from the eShepherd fence moves. The numbered strips of a pasture (C-1 to C-7) count as one stay in it.</p>
          <p className="mt-2">
            Days are nights: in on the 1st and out on the 6th is 5 days. A few days with the fence off between two strips of the same pasture, and nowhere else in between, does not break the stay. A stay of under a night is left out.
          </p>
          <p className="mt-2">Paddocks marked “eShepherd only” are not drawn on the pasture map, so they are grouped by their eShepherd name.</p>
          <p className="mt-2">LLD is the quarter sections the pasture’s fence takes in (10 acres or more), worked out from its shape on the map.</p>
        </>
      }
      actions={picker}
      tabs={<PillTabs tabs={VIEWS} value={view} onChange={(v) => set('view', v)} />}
    >
      {isLoading ? (
        <p className="py-16 text-center text-sm text-gray-400">Loading the moves…</p>
      ) : error ? (
        <p className="py-16 text-center text-sm text-red-600">{(error as Error).message}</p>
      ) : !result?.herds.length ? (
        <p className="py-16 text-center text-sm text-gray-500">No herd moves recorded in {year}{ranchId ? ` at ${ranchName}` : ''}.</p>
      ) : view === 'herd' ? (
        <div className="grid gap-4 2xl:grid-cols-2">
          {result.herds.map((h) => (
            <section key={h.mob} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <h2 className={cn('flex flex-wrap items-baseline justify-between gap-x-3', CARD_HEAD)}>
                <span className="font-semibold normal-case tracking-normal">{h.mob}</span>
                <span className="normal-case tracking-normal text-brand-100">
                  {h.head != null && `${n0(h.head)} head · `}
                  {nights(h.placedDays)} in a pasture{h.fenceOffDays ? ` · ${n0(h.fenceOffDays)} fence off` : ''}
                </span>
              </h2>
              <table className="w-full text-sm">
                <thead className={TABLE_HEAD}>
                  <tr className="bg-brand-600">
                    <th className="px-3 py-1.5 font-medium">Pasture</th>
                    <th className="px-3 py-1.5 font-medium">LLD</th>
                    <th className="px-3 py-1.5 text-right font-medium">Acres</th>
                    <th className="px-3 py-1.5 font-medium">In</th>
                    <th className="px-3 py-1.5 font-medium">Out</th>
                    <th className="px-3 py-1.5 text-right font-medium">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {h.stays.map((s) => (
                    <tr key={`${s.key}-${s.in}`} className="border-t border-gray-100">
                      <td className="px-3 py-1.5">
                        {s.pasture}
                        {!s.onMap && <span className="ml-1 text-xs text-gray-400">eShepherd only</span>}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-gray-600">{s.lld ?? '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{s.acres ? n0(s.acres) : '—'}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{day(s.in)}</td>
                      <td className={cn('whitespace-nowrap px-3 py-1.5 tabular-nums', !s.out && 'font-medium text-brand-700')}>{day(s.out)}</td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{n0(s.days)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 2xl:grid-cols-2">
          {result.pastures.map((p) => (
            <section key={p.key} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <h2 className={cn('flex flex-wrap items-baseline justify-between gap-x-3', CARD_HEAD)}>
                <span className="font-semibold normal-case tracking-normal">
                  {p.pasture}
                  {!p.onMap && <span className="ml-1 text-xs font-normal text-brand-100">eShepherd only</span>}
                </span>
                <span className="normal-case tracking-normal text-brand-100">
                  cattle in {nights(p.daysWithCattle)}
                </span>
              </h2>
              <table className="w-full text-sm">
                <thead className={TABLE_HEAD}>
                  <tr className="bg-brand-600">
                    <th className="px-3 py-1.5 font-medium">Herd</th>
                    <th className="px-3 py-1.5 font-medium">LLD</th>
                    <th className="px-3 py-1.5 text-right font-medium">Acres</th>
                    <th className="px-3 py-1.5 font-medium">First in</th>
                    <th className="px-3 py-1.5 font-medium">Last out</th>
                    <th className="px-3 py-1.5 text-right font-medium">Days</th>
                    <th className="px-3 py-1.5 text-right font-medium">Head</th>
                  </tr>
                </thead>
                <tbody>
                  {p.herds.map((h) => (
                    <tr key={h.mob} className="border-t border-gray-100">
                      <td className="px-3 py-1.5">
                        {h.mob}
                        {h.stays > 1 && <span className="ml-1 text-xs text-gray-400">{h.stays} stays</span>}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-gray-600">{p.lld ?? '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{p.acres ? n0(p.acres) : '—'}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{day(h.firstIn)}</td>
                      <td className={cn('whitespace-nowrap px-3 py-1.5 tabular-nums', !h.lastOut && 'font-medium text-brand-700')}>{day(h.lastOut)}</td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{n0(h.days)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{h.head != null ? n0(h.head) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                {p.head != null && (
                  <tfoot>
                    <tr className="border-t border-gray-200 bg-brand-50 font-semibold text-brand-900">
                      <td className="px-3 py-1.5" colSpan={6}>
                        Total head
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{n0(p.head)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </section>
          ))}
        </div>
      )}
    </Page>
  )
}
