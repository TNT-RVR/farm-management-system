import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Minus, X } from 'lucide-react'
import { CardList, RowCard } from '@/components/RowCards'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { useAllFields, useFields } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { CARD_HEAD, TABLE_HEAD, TABLE_TH } from '@/lib/table-style'
import { isCompanyOf, scoutPassed, type ScoutCompany, type ScoutReport } from '@/lib/scout-reports'
import { Grade, ScoutReportModal } from './ScoutDetail'
import { MoreLink } from './ScoutCompanyTab'

/**
 * Which of our fields can carry seed canola next year, and for whom.
 *
 * One row a field, one column a company. The question this page exists to
 * answer is asked once a winter and takes a spreadsheet and a phone call
 * otherwise: the seed canola acres have to be placed before anything else in
 * the rotation, and only the fields a company passed can take them.
 *
 * Fields nobody walked are folded underneath rather than left out. "Not
 * scouted" is a different answer from "failed", and the one that can still be
 * changed by asking.
 */
export function ScoutOverviewTab({
  year,
  rows,
  companies,
}: {
  year: number
  rows: ScoutReport[]
  companies: ScoutCompany[]
}) {
  // Every field, archived ones too: two of the quarters Corteva walked for
  // 2027 are fields we have retired, and naming them "archived field" told
  // nobody which ground was meant.
  const { data: fields } = useAllFields()
  const { data: active } = useFields()
  const forYear = useMemo(() => rows.filter((r) => r.crop_year === year && r.field_id), [rows, year])

  /** Only the companies that walked something this year get a column. */
  const shown = useMemo(() => {
    return companies.filter((c) => forYear.some((r) => isCompanyOf(c, r.company)))
  }, [companies, forYear])

  const lines = useMemo(() => {
    const byField = new Map<string, ScoutReport[]>()
    for (const r of forYear) byField.set(r.field_id!, [...(byField.get(r.field_id!) ?? []), r])
    return [...byField]
      .map(([fieldId, reports]) => {
        const field = fields?.find((f) => f.id === fieldId)
        const cells = shown.map((c) => {
          const report = reports.find((r) => isCompanyOf(c, r.company)) ?? null
          return { company: c, report, passed: report ? scoutPassed(report) : null }
        })
        const yes = cells.filter((c) => c.passed === true).map((c) => c.company.label)
        return {
          fieldId,
          name: field?.name ?? 'a field no longer on file',
          archived: !!field && !field.active,
          parcel: reports[0].parcel,
          acres: reports.find((r) => r.acres != null)?.acres ?? null,
          cells,
          yes,
        }
      })
      .sort((a, b) => (b.yes.length - a.yes.length) || a.name.localeCompare(b.name, 'en-CA', { numeric: true }))
  }, [forYear, fields, shown])

  const canGrow = lines.filter((l) => l.yes.length > 0)
  const canGrowAcres = canGrow.reduce((a, l) => a + (l.acres ?? 0), 0)
  // Only the fields still farmed: an archived one nobody walked is not a gap.
  const notScouted = (active ?? []).filter((f) => !forYear.some((r) => r.field_id === f.id))

  if (!forYear.length) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
        No company has scouted one of our fields for {year} yet.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <p className="text-sm text-gray-900">
          <span className="font-semibold tabular-nums">{canGrow.length}</span> of our{' '}
          <span className="tabular-nums">{lines.length}</span> scouted fields can carry seed canola in {year} —{' '}
          <span className="font-semibold tabular-nums">{Math.round(canGrowAcres).toLocaleString('en-CA')}</span> acres.
        </p>
        <HelpNote className="mt-1" summary="A tick means that company will grow seed canola on that field." title="How a field passes">
          Each company walks the quarters it might contract the summer before and grades them A to D. Corteva grows on
          A and B (from Corteva, 12 November 2026); the others have given no rule, so the same one is assumed. A
          field with no grade from a company is marked — rather than failed: nobody has looked at it.
        </HelpNote>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <h3 className={cn('font-medium', CARD_HEAD)}>Our fields, {year}</h3>
        <CardList>
          {lines.map((l) => (
            <RowCard
              key={l.fieldId}
              heading={
                <Link to={`/fields/${l.fieldId}/scout-reports`} className="text-brand-800 underline">
                  {l.name}
                </Link>
              }
              facts={[
                { label: 'Land', node: l.parcel },
                { label: 'Acres', node: l.acres == null ? null : `${Math.round(l.acres).toLocaleString('en-CA')} ac` },
                ...l.cells.map((c) => ({
                  label: c.company.label,
                  key: c.company.key,
                  node: (
                    <span className="inline-flex items-center gap-1.5">
                      <Grade rating={c.report?.rating ?? null} />
                      <Verdict passed={c.passed} />
                      {c.report && <Why report={c.report} fieldName={l.name} />}
                    </span>
                  ),
                })),
                {
                  label: 'Can grow for',
                  node: l.yes.length ? <span className="font-medium text-green-800">{l.yes.join(', ')}</span> : <span className="text-gray-500">nobody</span>,
                },
              ]}
            />
          ))}
        </CardList>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[620px] text-sm">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className={TABLE_TH}>Field</th>
                <th className={TABLE_TH}>Land</th>
                <th className={cn(TABLE_TH, 'text-right')}>Acres</th>
                {shown.map((c) => (
                  <th key={c.key} className={cn(TABLE_TH, 'text-center')}>
                    {c.label}
                  </th>
                ))}
                <th className={TABLE_TH}>Can grow seed canola for</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((l) => (
                <tr key={l.fieldId} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium">
                    <Link to={`/fields/${l.fieldId}/scout-reports`} className="text-brand-800 hover:underline">
                      {l.name}
                    </Link>
                    {l.archived && <span className="ml-1 text-xs font-normal text-gray-400">archived</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{l.parcel}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                    {l.acres == null ? '—' : Math.round(l.acres).toLocaleString('en-CA')}
                  </td>
                  {l.cells.map((c) => (
                    <td key={c.company.key} className="px-3 py-2">
                      <span className="flex items-center justify-center gap-1.5">
                        <Grade rating={c.report?.rating ?? null} />
                        <Verdict passed={c.passed} />
                        {c.report && <Why report={c.report} fieldName={l.name} />}
                      </span>
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    {l.yes.length ? (
                      <span className="font-medium text-green-800">{l.yes.join(', ')}</span>
                    ) : (
                      <span className="text-gray-500">nobody</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {notScouted.length > 0 && (
        <Fold
          title="Fields nobody walked"
          summary={`${notScouted.length} field${notScouted.length === 1 ? '' : 's'}`}
          storageKey="scout-not-walked"
        >
          <p className="mb-2 text-xs text-gray-500">
            No company has graded these for {year}, so they cannot be counted on for seed canola. Ask for a scout if one
            is wanted.
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {notScouted.map((f) => (
              <li key={f.id}>
                <Link
                  to={`/fields/${f.id}/scout-reports`}
                  className="inline-block rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-700 hover:border-brand-300 hover:bg-brand-50"
                >
                  {f.name}
                </Link>
              </li>
            ))}
          </ul>
        </Fold>
      )}
    </div>
  )
}

/**
 * The link to one company's report on this field.
 *
 * On the overview a row is a field across four companies, so there is no one
 * report to open underneath it — the link belongs in the cell, beside the
 * grade it explains (Sam, 13 Nov 2026).
 */
function Why({ report, fieldName }: { report: ScoutReport; fieldName: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <MoreLink parcel={report.parcel} onClick={() => setOpen(true)} />
      {open && <ScoutReportModal report={report} fieldName={fieldName} onClose={() => setOpen(false)} />}
    </>
  )
}

function Verdict({ passed }: { passed: boolean | null }) {
  if (passed == null) return <Minus className="h-3.5 w-3.5 text-gray-300" aria-label="not scouted" />
  return passed ? (
    <Check className="h-4 w-4 text-green-700" aria-label="passed" />
  ) : (
    <X className="h-4 w-4 text-red-600" aria-label="failed" />
  )
}
