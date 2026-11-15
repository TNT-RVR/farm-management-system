import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Info } from 'lucide-react'
import { CardList, RowCard } from '@/components/RowCards'
import { HelpNote } from '@/components/HelpNote'
import { useAllFields } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { CARD_HEAD, TABLE_HEAD, TABLE_TH } from '@/lib/table-style'
import { gradeRank, scoutPassed, useSetScoutField, type ScoutCompany, type ScoutReport } from '@/lib/scout-reports'
import { Grade, ScoutReportModal } from './ScoutDetail'

/**
 * One company's scouting for one year.
 *
 * Our fields first, then the neighbours' land, because they are two different
 * questions: what can we put seed canola on, and what could we take on. Most
 * of what a company walks is the second — Corteva's 2027 sheet has 29
 * quarters and 12 of them are ours.
 *
 * Worst grade first inside each list: a D is the row somebody needs to see.
 */
export function ScoutCompanyTab({
  company,
  year,
  rows,
  isManager,
}: {
  company: ScoutCompany
  year: number
  rows: ScoutReport[]
  isManager: boolean
}) {
  const mine = useMemo(
    () => rows.filter((r) => r.field_id).sort((a, b) => gradeRank(b.rating) - gradeRank(a.rating) || a.parcel.localeCompare(b.parcel)),
    [rows],
  )
  const theirs = useMemo(
    () => rows.filter((r) => !r.field_id).sort((a, b) => gradeRank(b.rating) - gradeRank(a.rating) || a.parcel.localeCompare(b.parcel)),
    [rows],
  )
  const passed = mine.filter((r) => scoutPassed(r) === true)
  const passedAcres = passed.reduce((a, r) => a + (r.acres ?? 0), 0)

  if (!rows.length) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
        Nothing from {company.label} for {year}. Their sheet goes in with{' '}
        <code className="rounded bg-gray-100 px-1 text-xs">scripts/import-prescouts.mjs</code>.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <p className="text-sm text-gray-900">
          {company.label} graded <span className="font-semibold tabular-nums">{rows.length}</span> quarters for {year}.{' '}
          <span className="font-semibold tabular-nums">{passed.length}</span> of ours passed
          {passedAcres > 0 && <> — {Math.round(passedAcres).toLocaleString('en-CA')} acres</>}.
        </p>
        <HelpNote
          className="mt-1"
          summary={company.rule ?? `No grading rule from ${company.label} on file — A and B are taken as a pass, as Corteva's are.`}
          title="What the grades mean"
        >
          Every field the company might contract is walked the summer before and graded A to D. The grade is the gate:
          it decides whether they will put seed canola on that ground next year, whatever the rotation says about it.
          {company.rule
            ? ' '
            : ` Nobody has told us ${company.label}'s rule yet, so the page assumes the same one Corteva gave. Change it in src/lib/scout-reports.ts when they say.`}
          {company.rule && ` Grades outside ${company.pass.join(' and ')} fail.`}
        </HelpNote>
      </div>

      <Section title="Our fields" rows={mine} isManager={isManager} empty="None of the quarters they walked are ours." />
      <Section
        title="Neighbours' land"
        rows={theirs}
        isManager={isManager}
        empty="Every quarter they walked is ours."
        note="Ground we do not farm, walked because it could be taken on. Press “one of ours” on a row that is in fact a field of ours."
      />
    </div>
  )
}

function Section({
  title,
  rows,
  isManager,
  empty,
  note,
}: {
  title: string
  rows: ScoutReport[]
  isManager: boolean
  empty: string
  note?: string
}) {
  const acres = rows.reduce((a, r) => a + (r.acres ?? 0), 0)
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <h3 className={cn('flex items-baseline justify-between gap-2', CARD_HEAD)}>
        <span className="font-medium">{title}</span>
        <span className="font-normal tabular-nums">
          {rows.length} · {Math.round(acres).toLocaleString('en-CA')} ac
        </span>
      </h3>
      {note && <p className="border-b border-gray-100 px-3 py-2 text-xs text-gray-500">{note}</p>}
      {rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-gray-400">{empty}</p>
      ) : (
        <>
          <CardList>
            {rows.map((r) => (
              <ReportCard key={r.id} report={r} isManager={isManager} />
            ))}
          </CardList>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[640px] text-sm">
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className={TABLE_TH}>Land</th>
                  <th className={TABLE_TH}>Field</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Acres</th>
                  <th className={cn(TABLE_TH, 'text-center')}>Grade</th>
                  <th className={TABLE_TH}>Crop walked</th>
                  <th className={TABLE_TH}>The agronomist said</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Why</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <ReportRow key={r.id} report={r} isManager={isManager} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

/** The picker that links a scouted quarter to one of our fields. */
function LinkField({ report }: { report: ScoutReport }) {
  const { data: fields } = useAllFields()
  const setField = useSetScoutField()
  return (
    <select
      className="rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-700"
      value={report.field_id ?? ''}
      onChange={(e) => setField.mutate({ id: report.id, fieldId: e.target.value || null })}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Which of our fields is ${report.parcel}`}
    >
      <option value="">{report.field_id ? 'not one of ours' : 'one of ours…'}</option>
      {(fields ?? []).map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
          {f.legal_land_description ? ` · ${f.legal_land_description}` : ''}
        </option>
      ))}
    </select>
  )
}

function fieldName(report: ScoutReport, fields: { id: string; name: string }[] | undefined) {
  return fields?.find((f) => f.id === report.field_id)?.name ?? null
}

function ReportRow({ report, isManager }: { report: ScoutReport; isManager: boolean }) {
  const [open, setOpen] = useState(false)
  const { data: fields } = useAllFields()
  const name = fieldName(report, fields)
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2 font-medium text-gray-900">{report.parcel}</td>
      <td className="px-3 py-2 text-gray-700">
        {report.field_id && name ? (
          <Link to={`/fields/${report.field_id}/scout-reports`} className="text-brand-700 underline">
            {name}
          </Link>
        ) : isManager ? (
          <LinkField report={report} />
        ) : (
          <span className="text-gray-400">&mdash;</span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-700">
        {report.acres == null ? '\u2014' : Math.round(report.acres).toLocaleString('en-CA')}
      </td>
      <td className="px-3 py-2 text-center">
        <Grade rating={report.rating} />
      </td>
      <td className="px-3 py-2 text-gray-700">{report.crop_this_year ?? '\u2014'}</td>
      <td className="max-w-[16rem] truncate px-3 py-2 text-gray-600">{report.agronomist_note ?? '\u2014'}</td>
      <td className="px-3 py-2 text-right">
        <MoreLink parcel={report.parcel} onClick={() => setOpen(true)} />
        {/* The pop-up is drawn on the page body by its portal, so opening it
            from inside a cell leaves the table valid. */}
        {open && (
          <ScoutReportModal report={report} fieldName={name} onClose={() => setOpen(false)}>
            {isManager && <LinkField report={report} />}
          </ScoutReportModal>
        )}
      </td>
    </tr>
  )
}

/** The link that opens one report in full. */
export function MoreLink({ parcel, onClick }: { parcel: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Why ${parcel} was graded as it was`}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-gray-200 px-2 py-0.5 text-xs text-brand-800 hover:border-brand-300 hover:bg-brand-50"
    >
      <Info className="h-3 w-3" />
      More
    </button>
  )
}

function ReportCard({ report, isManager }: { report: ScoutReport; isManager: boolean }) {
  const [open, setOpen] = useState(false)
  const { data: fields } = useAllFields()
  const name = fieldName(report, fields)
  return (
    <RowCard
      heading={
        <span className="flex items-center gap-2">
          <Grade rating={report.rating} />
          {report.parcel}
        </span>
      }
      actions={<MoreLink parcel={report.parcel} onClick={() => setOpen(true)} />}
      facts={[
        { label: 'Field', node: name ?? (isManager ? <LinkField report={report} /> : null) },
        { label: 'Acres', node: report.acres == null ? null : `${Math.round(report.acres).toLocaleString('en-CA')} ac` },
        { label: 'Crop walked', node: report.crop_this_year },
        { label: 'Agronomist', node: report.agronomist_note },
      ]}
    >
      {open && (
        <ScoutReportModal report={report} fieldName={name} onClose={() => setOpen(false)}>
          {isManager && <LinkField report={report} />}
        </ScoutReportModal>
      )}
    </RowCard>
  )
}
