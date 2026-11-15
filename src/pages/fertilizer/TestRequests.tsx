import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { Select } from '@/components/Select'
import { HelpNote } from '@/components/HelpNote'
import { useFields } from '@/lib/queries'
import { useSoilTestCoverage } from '@/lib/soilTests'
import { lastTestedBefore, requestYearOf, useSoilTestRequestMutations, useSoilTestRequests } from '@/lib/soil-test-requests'
import { localDateKey } from '@/lib/ranchWeather'

/**
 * Soil tests → To test: tick the fields to sample, then make the report for
 * the lab. One list a crop year; a fall sample is for next year's crop.
 */
export function TestRequests({ canEdit }: { canEdit: boolean }) {
  const thisYear = requestYearOf(localDateKey())
  const [year, setYear] = useState(thisYear)
  const { data: fields } = useFields()
  const { data: coverage } = useSoilTestCoverage()
  const { data: requests, isLoading } = useSoilTestRequests(year)
  const { set, note } = useSoilTestRequestMutations(year)

  const last = useMemo(() => lastTestedBefore(coverage ?? [], year), [coverage, year])
  const byField = useMemo(() => new Map((requests ?? []).map((r) => [r.field_id, r])), [requests])
  const list = fields ?? []
  const ticked = list.filter((f) => byField.has(f.id))
  const busy = set.isPending

  const yearOptions = [thisYear - 1, thisYear, thisYear + 1].map((y) => ({ value: String(y), label: `For the ${y} crop` }))

  return (
    <div className="max-w-3xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={String(year)} onChange={(v) => setYear(Number(v))} options={yearOptions} ariaLabel="Crop year" className="w-48" />
        <HelpNote>
          Tick the fields you want sampled, then make the Soil test request report to send the lab. A sample pulled from July on
          is for next year&rsquo;s crop, the same year its results are filed under.
        </HelpNote>
        <span className="text-sm text-gray-600">
          {ticked.length} of {list.length} fields ticked
        </span>
        <Link
          to={`/reports?open=soil-test-request&year=${year}`}
          className="ml-auto flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800"
        >
          <FileText className="h-4 w-4" /> Report for the lab
        </Link>
      </div>

      {set.error && <p className="mb-2 text-sm text-red-700">{(set.error as Error).message}</p>}

      {canEdit && list.length > 0 && (
        <div className="mb-2 flex gap-2 text-xs">
          <button
            disabled={busy}
            onClick={() => set.mutate({ fieldIds: list.filter((f) => !byField.has(f.id)).map((f) => f.id), on: true })}
            className="rounded border border-gray-200 bg-white px-2 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Tick all
          </button>
          <button
            disabled={busy || !ticked.length}
            onClick={() => set.mutate({ fieldIds: ticked.map((f) => f.id), on: false })}
            className="rounded border border-gray-200 bg-white px-2 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="py-16 text-center text-sm text-gray-400">Loading…</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {list.map((f) => {
            const req = byField.get(f.id)
            const lastYear = last.get(f.id)
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <label className="flex min-w-0 flex-1 basis-60 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-700"
                    checked={Boolean(req)}
                    disabled={!canEdit || busy}
                    onChange={(e) => set.mutate({ fieldIds: [f.id], on: e.target.checked })}
                  />
                  <span className="text-sm font-medium text-gray-900">{f.name}</span>
                  {f.legal_land_description && <span className="truncate text-xs text-gray-500">{f.legal_land_description}</span>}
                </label>
                <span className={lastYear ? 'text-xs text-gray-500' : 'text-xs text-amber-700'}>
                  {lastYear ? `Last tested ${lastYear}` : 'No test on file'}
                </span>
                {req && (
                  <input
                    key={`${req.id}:${req.notes ?? ''}`}
                    defaultValue={req.notes ?? ''}
                    disabled={!canEdit}
                    placeholder="Note for the lab"
                    onBlur={(e) => e.target.value.trim() !== (req.notes ?? '') && note.mutate({ id: req.id, notes: e.target.value })}
                    className="w-full rounded border border-gray-200 px-2 py-1 text-xs sm:ml-6"
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
