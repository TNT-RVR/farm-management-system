import { cn } from '@/lib/utils'
import { Modal } from '@/components/Modal'
import { GRADE_STYLE, SCOUT_WEEDS, companyOf, passReason, scoutPassed, type ScoutReport } from '@/lib/scout-reports'

/**
 * What one scout report says, in full.
 *
 * Shown under a row on the company tab and on a field's own tab, so both say
 * the same thing in the same order: the grade and what it means, then the
 * agronomist's verdict, then the two walks, then the counts behind them.
 */

/** A, B, C or D in its own chip. */
export function Grade({ rating, className }: { rating: string | null; className?: string }) {
  const g = (rating ?? '').trim().toUpperCase()
  if (!g) return <span className="text-xs text-gray-400">not graded</span>
  return (
    <span className={cn('inline-block rounded px-1.5 py-0.5 text-xs font-semibold', GRADE_STYLE[g] ?? 'bg-gray-100 text-gray-700', className)}>
      {g}
    </span>
  )
}

/** "Corteva will grow here" / "Corteva will not" / "not scouted". */
export function PassLine({ report }: { report: ScoutReport }) {
  const passed = scoutPassed(report)
  const label = companyOf(report.company).label
  if (passed == null) return <span className="text-xs text-gray-500">{label} has not graded this one.</span>
  return (
    <span className={cn('text-xs font-medium', passed ? 'text-green-800' : 'text-red-800')}>
      {passed ? `${label} will grow seed canola here.` : `${label} will not grow seed canola here.`}
    </span>
  )
}

const dateText = (v: string | null) =>
  v ? new Date(`${v}T12:00:00`).toLocaleDateString('en-CA', { day: 'numeric', month: 'short', year: 'numeric' }) : null

/** One walk's weed counts, as a line. Null when nothing was counted. */
function countsLine(report: ScoutReport, pass: 'ps1' | 'ps2'): string | null {
  const row = report.counts?.[pass]
  if (!row) return null
  const parts: string[] = []
  for (const w of SCOUT_WEEDS) {
    const c = row[w.key]
    const ic = Number(c?.ic ?? 0)
    const bc = Number(c?.bc ?? 0)
    if (ic <= 0 && bc <= 0) continue
    const bits = [ic > 0 ? `${ic} in count` : null, bc > 0 ? `${bc} between` : null].filter(Boolean)
    parts.push(`${w.label}: ${bits.join(', ')}`)
  }
  return parts.length ? parts.join(' · ') : null
}

function Walk({
  title,
  on,
  stage,
  by,
  notes,
  counts,
}: {
  title: string
  on: string | null
  stage?: string | null
  by?: string | null
  notes: string | null
  counts: string | null
}) {
  if (!on && !notes && !counts) return null
  return (
    <div>
      <p className="text-xs font-medium text-gray-900">
        {title}
        {on && <span className="ml-1.5 font-normal text-gray-500">{dateText(on)}</span>}
        {stage && <span className="ml-1.5 font-normal text-gray-500">· {stage}</span>}
        {by && <span className="ml-1.5 font-normal text-gray-500">· {by}</span>}
      </p>
      {counts ? (
        <p className="mt-0.5 text-xs text-gray-700">{counts}</p>
      ) : (
        on && <p className="mt-0.5 text-xs text-gray-500">Nothing counted.</p>
      )}
      {notes && <p className="mt-0.5 text-xs italic text-gray-600">“{notes}”</p>}
    </div>
  )
}

/** The verdict and the rule behind it, in a box of its own. */
export function Verdict({ report }: { report: ScoutReport }) {
  const passed = scoutPassed(report)
  const tone =
    passed === true
      ? 'border-green-200 bg-green-50 text-green-900'
      : passed === false
        ? 'border-red-200 bg-red-50 text-red-900'
        : 'border-gray-200 bg-gray-50 text-gray-700'
  return (
    <div className={cn('rounded border px-2 py-1.5', tone)}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
        <Grade rating={report.rating} />
        <PassLine report={report} />
      </p>
      <p className="mt-0.5 text-xs opacity-90">{passReason(report)}</p>
    </div>
  )
}

export function ScoutDetail({ report, showParcel = false }: { report: ScoutReport; showParcel?: boolean }) {
  const history = (report.crop_history ?? []).filter(Boolean)
  return (
    <div className="space-y-2.5 text-xs">
      <Verdict report={report} />
      {showParcel && <p className="text-gray-500">{report.parcel}</p>}

      {report.agronomist_note && (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-900">
          <span className="font-medium">Agronomist:</span> {report.agronomist_note}
        </p>
      )}

      <dl className="grid grid-cols-[fit-content(9rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
        {report.crop_this_year && (
          <>
            <dt className="text-gray-500">Crop when walked</dt>
            <dd className="text-gray-900">{report.crop_this_year}</dd>
          </>
        )}
        {history.length > 0 && (
          <>
            <dt className="text-gray-500">Years before</dt>
            <dd className="text-gray-900">{history.join(' → ')}</dd>
          </>
        )}
        {report.last_canola_year != null && (
          <>
            <dt className="text-gray-500">Last canola</dt>
            <dd className="text-gray-900">
              {report.last_canola_year}
              {report.last_canola_tech && ` · ${report.last_canola_tech}`}
            </dd>
          </>
        )}
        {report.vc_per_m2 != null && report.vc_per_m2 > 0 && (
          <>
            <dt className="text-gray-500">Volunteer canola</dt>
            <dd className="text-gray-900 tabular-nums">{report.vc_per_m2} per m²</dd>
          </>
        )}
        {report.tissue_summary && (
          <>
            <dt className="text-gray-500">Tissue test</dt>
            <dd className="text-gray-900">
              {report.tissue_summary}
              {report.tissue_on && <span className="text-gray-500"> · {dateText(report.tissue_on)}</span>}
            </dd>
          </>
        )}
        {report.scouting_method && (
          <>
            <dt className="text-gray-500">How</dt>
            <dd className="text-gray-900">{report.scouting_method}</dd>
          </>
        )}
        {report.contact_name && (
          <>
            <dt className="text-gray-500">Safe entry</dt>
            <dd className="text-gray-900">
              {report.contact_name}
              {report.contact_phone && <span className="text-gray-500"> · {report.contact_phone}</span>}
            </dd>
          </>
        )}
      </dl>

      <div className="space-y-2 border-t border-gray-100 pt-2">
        <Walk title="First walk" on={report.ps1_on} stage={report.ps1_stage} notes={report.ps1_notes} counts={countsLine(report, 'ps1')} />
        <Walk
          title="Second walk"
          on={report.ps2_on}
          by={report.ps2_by}
          notes={report.ps2_notes}
          counts={countsLine(report, 'ps2')}
        />
        {report.ps2_required && !report.ps2_on && <p className="text-xs text-gray-500">A second walk was asked for and has not been recorded.</p>}
      </div>
    </div>
  )
}

/**
 * One report in full, in a pop-up (Sam, 13 Nov 2026: "a link on each row to
 * see more information which pops up a detailed info pop up window").
 *
 * The rows used to open underneath themselves, which worked on the company
 * tab and could not work on the overview, where a row is a field across four
 * companies rather than one report. A pop-up reads the same from both, and on
 * a phone it is the whole screen instead of a card that grows under a thumb.
 */
export function ScoutReportModal({
  report,
  fieldName,
  onClose,
  children,
}: {
  report: ScoutReport
  /** Our field, when the parcel is one of ours. */
  fieldName?: string | null
  onClose: () => void
  /** The picker that links this parcel to a field of ours, for a manager. */
  children?: React.ReactNode
}) {
  return (
    <Modal
      title={`${companyOf(report.company).label} · ${report.parcel}`}
      onClose={onClose}
      wide
    >
      <p className="mb-2 text-xs text-gray-500">
        {fieldName ? <span className="font-medium text-gray-700">{fieldName}</span> : 'Not one of our fields'}
        {' · '}crop year {report.crop_year}
        {report.scouted_year && ` · walked in ${report.scouted_year}`}
        {report.acres != null && ` · ${Math.round(report.acres).toLocaleString('en-CA')} ac`}
      </p>
      <ScoutDetail report={report} />
      {children && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2 text-xs text-gray-500">
          Which of our fields is this? {children}
        </div>
      )}
    </Modal>
  )
}
