import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { CARD_HEAD } from '@/lib/table-style'
import { companyOf, scoutPassed, useFieldScoutReports, type ScoutReport } from '@/lib/scout-reports'
import { Grade, ScoutDetail } from '@/pages/scout/ScoutDetail'

/**
 * One field's seed canola scout reports, newest year first.
 *
 * A field's grade is not a fact about this year — it is a record of how the
 * ground has been trending. A quarter that went A, A, C is a quarter with a
 * volunteer canola problem building in it, and that is only visible with the
 * years stacked up, which is why this is a tab of its own rather than a line
 * on the overview.
 */
export function FieldScoutReports({ fieldId }: { fieldId: string }) {
  const { data: rows, isLoading } = useFieldScoutReports(fieldId)

  if (isLoading) return <p className="mt-4 text-sm text-gray-500">Loading…</p>

  if (!rows?.length) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center">
        <p className="text-sm text-gray-500">No seed company has scouted this field.</p>
        <p className="mt-1 text-xs text-gray-400">
          A quarter they walked under a different legal land description can be linked on the{' '}
          <Link to="/scout-reports" className="text-brand-700 underline">
            scout reports page
          </Link>
          .
        </p>
      </div>
    )
  }

  const years = [...new Set(rows.map((r) => r.crop_year))].sort((a, b) => b - a)

  return (
    <div className="mt-4 space-y-4">
      <Trend rows={rows} />
      {years.map((y) => (
        <div key={y} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <h3 className={cn('font-medium', CARD_HEAD)}>Crop year {y}</h3>
          <div className="divide-y divide-gray-100">
            {rows
              .filter((r) => r.crop_year === y)
              .map((r) => (
                <div key={r.id} className="p-3">
                  <p className="mb-1.5 text-sm font-medium text-gray-900">
                    {companyOf(r.company).label}
                    {r.scouted_year && <span className="ml-1.5 text-xs font-normal text-gray-500">walked in {r.scouted_year}</span>}
                  </p>
                  <ScoutDetail report={r} showParcel />
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Every grade this field has been given, oldest on the left. */
function Trend({ rows }: { rows: ScoutReport[] }) {
  const byCompany = new Map<string, ScoutReport[]>()
  for (const r of rows) byCompany.set(r.company, [...(byCompany.get(r.company) ?? []), r])
  if (rows.length < 2) return null
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <h3 className={cn('font-medium', CARD_HEAD)}>How it has graded</h3>
      <div className="space-y-2 p-3">
        {[...byCompany].map(([company, list]) => (
          <div key={company} className="flex flex-wrap items-center gap-2">
            <span className="w-20 shrink-0 text-xs font-medium text-gray-700">{companyOf(company).label}</span>
            {[...list]
              .sort((a, b) => a.crop_year - b.crop_year)
              .map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1 text-xs text-gray-500">
                  {r.crop_year}
                  <Grade rating={r.rating} />
                  {scoutPassed(r) === false && <span className="text-red-700">·</span>}
                </span>
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}
