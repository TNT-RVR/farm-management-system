import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { isOwner, useAuth } from '@/lib/auth'
import { useVisibleReports } from '@/lib/reports/visible'
import { farmTz } from '@/lib/farm-context'
import { useCropYear } from '@/lib/crop-year'
import { useUnitSystem } from '@/lib/units'
import { REPORT_SECTIONS, SUGGESTED_REPORTS } from '@/lib/reports/catalogue'
import type { GatherContext } from '@/lib/reports/framework'
import { BuiltRow, OpenRow } from '@/pages/reports/ReportRow'

/**
 * Reports: every file the app can hand to somebody, in one place, a row
 * each, by what it is about — and below each section, greyed out, the ones
 * worth building next. Each row makes a CSV or a PDF from the same data
 * (the PDF carries the farm's logo and colours), and a few also a file of
 * their own (a ZIP of invoices or a shapefile, Markdown for an AI chat).
 */
export function ReportsPage() {
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  const units = useUnitSystem()
  const { viewOff, reports, isAdmin, isManager } = useVisibleReports()

  // ?open=<report id>, from the search bar: that report's dialog, already open.
  const [params] = useSearchParams()
  const openId = params.get('open')

  const ctx = useMemo<GatherContext>(
    () => ({
      today: new Date().toLocaleDateString('en-CA', { timeZone: farmTz() }),
      cropYear,
      isAdmin,
      isManager,
      isOwner: isOwner(profile),
      units,
      viewOff,
    }),
    [cropYear, isAdmin, isManager, profile, units, viewOff],
  )

  return (
    <div className="p-4 md:p-6">
      <h1 className="flex items-center gap-1.5 text-lg font-semibold text-gray-900">
        <FileText className="h-5 w-5 text-brand-700" /> Reports
      </h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-600">Press Download to choose the file type, year, field and the rest.</p>

      <nav aria-label="Report sections" className="mt-3 flex flex-wrap gap-1.5">
        {REPORT_SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => document.getElementById(`reports-${s.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-brand-300 hover:text-brand-800"
          >
            {s.title}
          </button>
        ))}
      </nav>

      <div className="mt-5 space-y-6">
        {REPORT_SECTIONS.map((s) => {
          const here = reports.filter((r) => r.section === s.key)
          const ideas = SUGGESTED_REPORTS.filter((r) => r.section === s.key && !viewOff(r.from.to))
          if (!here.length && !ideas.length) return null
          return (
            <section key={s.key} id={`reports-${s.key}`} className="scroll-mt-4">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{s.title}</h2>
              <ul className="flex flex-col gap-1.5">
                {here.map((r) => {
                  const key = r.id === openId ? `${r.id}:open` : r.id
                  return r.mode === 'build' ? <BuiltRow key={key} r={r} ctx={ctx} autoOpen={r.id === openId} /> : <OpenRow key={key} r={r} autoOpen={r.id === openId} />
                })}
                {ideas.map((r) => (
                  <li key={r.name} className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-1.5">
                    <span className="text-sm font-medium text-gray-500">{r.name}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-gray-400" title={r.what}>
                      {r.what}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Not built yet</span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
