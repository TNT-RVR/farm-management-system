import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarClock, ChevronDown, ChevronRight } from 'lucide-react'
import { fieldPhi, type FieldPhi } from '@/lib/phi'
import { loadPhiSeason } from '@/lib/phi-data'
import { cn } from '@/lib/utils'

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
export function PhiPanel({ cropYear }: { cropYear: number }) {
  const { data } = usePhiSeason(cropYear)
  const [open, setOpen] = useState(false)
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
  if (!fields.length) return null

  return (
    <div className="mb-3 rounded-lg border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm">
        {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
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
        <div className="overflow-x-auto border-t border-gray-100">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-3 py-1 font-medium">Field</th>
                <th className="px-3 py-1 font-medium">Clear to harvest</th>
                <th className="px-3 py-1 font-medium">Set by</th>
                <th className="px-3 py-1 font-medium">Harvest started</th>
                <th className="px-3 py-1 font-medium">Interval unknown</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {fields.map((f) => (
                <tr key={f.fieldId}>
                  <td className="px-3 py-1">
                    <Link to={`/fields/${f.fieldId}/work`} className="text-gray-800 hover:underline">
                      {f.name}
                    </Link>
                  </td>
                  <td className={cn('px-3 py-1 tabular-nums', f.safeFrom && f.safeFrom > today && 'font-semibold text-amber-800')}>
                    {f.safeFrom ? fmt(f.safeFrom) : '—'}
                  </td>
                  <td className="px-3 py-1 text-gray-600">
                    {f.limiting ? `${f.limiting.product} · ${f.limiting.phiDays} d from ${fmt(f.limiting.appliedOn)}` : '—'}
                  </td>
                  <td className="px-3 py-1 tabular-nums text-gray-600">{data?.harvestStart.get(f.fieldId) ? fmt(data.harvestStart.get(f.fieldId)!) : '—'}</td>
                  <td className="px-3 py-1 text-gray-500">{f.unknown.length ? [...new Set(f.unknown.map((u) => u.product))].join(', ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-1.5 text-[11px] text-gray-400">
            From every chemical pass Deere logged this season and the label&apos;s pre-harvest interval for the crop on that pass. A product
            whose label is unread, or that gives no interval for this crop, is listed as unknown — never as clear. Harvest start is the
            first Deere harvest pass or the first weighed load, whichever came first.{' '}
            <Link to="/chemicals" className="underline">
              Labels
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}
