import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarClock, ChevronDown, ChevronRight } from 'lucide-react'
import { fieldPhi, type FieldPhi } from '@/lib/phi'
import { loadPhiSeason } from '@/lib/phi-data'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'
import { TABLE_HEAD } from '@/lib/table-style'

/**
 * Every chemical sprayed this season with its pre-harvest interval, and the
 * first day each field is clear to combine. Harvest start is the first Deere
 * harvest pass or the first load weighed off the field, whichever is earlier.
 */
export function usePhiSeason(cropYear: number) {
  return useQuery({
    queryKey: ['phi', cropYear],
    queryFn: () => loadPhiSeason(cropYear),
    staleTime: 10 * 60_000,
  })
}

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

/**
 * The fields not yet clear to harvest, and any harvested too soon. Stays out
 * of the way when there is nothing to say.
 */
export function PhiPanel({ cropYear, defaultOpen = false, emptyText, flat = false }: { cropYear: number; defaultOpen?: boolean; emptyText?: string; flat?: boolean }) {
  const { data } = usePhiSeason(cropYear)
  const [openState, setOpen] = useState(defaultOpen)
  // On its own tab it does not fold (Sam, 23 Oct 2026).
  const open = flat || openState
  const today = new Date().toLocaleDateString('en-CA')

  const fields = useMemo(() => {
    if (!data) return [] as (FieldPhi & { name: string })[]
    const ids = [...new Set(data.apps.map((a) => a.fieldId))]
    return ids
      .map((id) => ({ ...fieldPhi(id, data.apps, data.harvestStart.get(id) ?? null), name: data.names.get(id) ?? '' }))
      .sort((a, b) => (b.safeFrom ?? '').localeCompare(a.safeFrom ?? ''))
  }, [data])

  const waiting = fields.filter((f) => f.safeFrom && f.safeFrom > today && !data?.harvestStart.get(f.fieldId))
  const early = fields.filter((f) => f.violation)
  if (!fields.length) return emptyText ? <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">{emptyText}</p> : null

  return (
    <div className="mb-3 rounded-lg border border-gray-200 bg-white">
      <button type="button" disabled={flat} onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm disabled:cursor-default">
        {!flat && (open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />)}
        <CalendarClock className="h-4 w-4 text-gray-500" />
        <span className="font-semibold text-gray-900">Pre-harvest intervals</span>
        {early.length > 0 && (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800">
            {early.length} harvested early
          </span>
        )}
        {waiting.length > 0 ? (
          <span className="text-xs text-amber-800">
            {waiting.length} field{waiting.length === 1 ? '' : 's'} not clear yet — next: {waiting[waiting.length - 1].name} on {fmt(waiting[waiting.length - 1].safeFrom!)}
          </span>
        ) : (
          <span className="text-xs text-gray-500">every sprayed field is clear</span>
        )}
      </button>
      {early.length > 0 && (
        <div className="border-t border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
          {early.map((f) => (
            <p key={f.fieldId} className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {f.name}: harvest started {fmt(f.violation!.harvestedOn)}, {f.violation!.daysEarly} day
              {f.violation!.daysEarly === 1 ? '' : 's'} inside {f.limiting?.product}&apos;s interval ({f.limiting?.phiDays} days from {fmt(f.limiting!.appliedOn)}). Check with the buyer before delivering.
            </p>
          ))}
        </div>
      )}
      {open && (
        <div className="border-t border-gray-100">
          {/*
            Phone: one card a field. Five columns on a 375 px screen squeezed
            every cell to about a word wide — "Reglone Ion · 7 d from Sep 25"
            ran to four lines and a single row stood half a screen tall
            (Sam, 28 Oct 2026).
          */}
          <ul className="divide-y divide-gray-100 sm:hidden">
            {fields.map((f) => {
              const started = data?.harvestStart.get(f.fieldId) ?? null
              const notClear = !!f.safeFrom && f.safeFrom > today && !started
              const unknown = [...new Set(f.unknown.map((u) => u.product))]
              return (
                <li key={f.fieldId} className="px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link to={`/fields/${f.fieldId}/work`} className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 hover:underline">
                      {f.name}
                    </Link>
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                        f.violation ? 'bg-red-100 text-red-800' : notClear ? 'bg-amber-100 text-amber-900' : 'bg-green-100 text-green-800',
                      )}
                    >
                      {f.violation ? 'Harvested early' : notClear ? `Clear ${fmt(f.safeFrom!)}` : 'Clear'}
                    </span>
                  </div>
                  <dl className="mt-1 space-y-0.5 text-xs text-gray-600">
                    {f.limiting && (
                      <div className="flex gap-1.5">
                        <dt className="shrink-0 text-gray-400">Set by</dt>
                        <dd className="min-w-0 flex-1">
                          {f.limiting.product} · {f.limiting.phiDays} d from {fmt(f.limiting.appliedOn)}
                        </dd>
                      </div>
                    )}
                    {started && (
                      <div className="flex gap-1.5">
                        <dt className="shrink-0 text-gray-400">Harvest started</dt>
                        <dd className="tabular-nums">{fmt(started)}</dd>
                      </div>
                    )}
                    {unknown.length > 0 && (
                      <div className="flex gap-1.5">
                        <dt className="shrink-0 text-gray-400">Interval unknown</dt>
                        <dd className="min-w-0 flex-1">{unknown.join(', ')}</dd>
                      </div>
                    )}
                  </dl>
                </li>
              )
            })}
          </ul>
          <table className="hidden w-full text-sm sm:table">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="px-3 py-2 font-medium">Field</th>
                <th className="px-3 py-2 font-medium">Clear to harvest</th>
                <th className="px-3 py-2 font-medium">Set by</th>
                <th className="px-3 py-2 font-medium">Harvest started</th>
                <th className="px-3 py-2 font-medium">Interval unknown</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {fields.map((f) => (
                <tr key={f.fieldId}>
                  <td className="px-3 py-2 font-medium">
                    <Link to={`/fields/${f.fieldId}/work`} className="text-gray-900 hover:underline">
                      {f.name}
                    </Link>
                  </td>
                  <td className={cn('px-3 py-2 tabular-nums', f.safeFrom && f.safeFrom > today && 'font-semibold text-amber-800')}>
                    {f.safeFrom ? fmt(f.safeFrom) : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {f.limiting ? `${f.limiting.product} · ${f.limiting.phiDays} d from ${fmt(f.limiting.appliedOn)}` : '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">{data?.harvestStart.get(f.fieldId) ? fmt(data.harvestStart.get(f.fieldId)!) : '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{f.unknown.length ? [...new Set(f.unknown.map((u) => u.product))].join(', ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <HelpNote className="px-3 py-1.5" summary="An unread label is listed as unknown, never as clear." title="Where these come from">
            From every chemical pass Deere logged this season and the label&apos;s pre-harvest interval for the crop on that pass. A product
            whose label is unread, or that gives no interval for this crop, is listed as unknown — never as clear. Harvest start is the
            first Deere harvest pass or the first weighed load, whichever came first.{' '}
            <Link to="/chemicals" className="underline">
              Labels
            </Link>
          </HelpNote>
        </div>
      )}
    </div>
  )
}
