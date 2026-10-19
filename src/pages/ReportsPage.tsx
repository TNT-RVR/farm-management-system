import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileText, Search, Star, X } from 'lucide-react'
import { isOwner, useAuth } from '@/lib/auth'
import { useVisibleReports } from '@/lib/reports/visible'
import { farmTz } from '@/lib/farm-context'
import { useCropYear } from '@/lib/crop-year'
import { useUnitSystem } from '@/lib/units'
import { REPORT_SECTIONS, SUGGESTED_REPORTS } from '@/lib/reports/catalogue'
import type { GatherContext } from '@/lib/reports/framework'
import { BuiltRow, OpenRow } from '@/pages/reports/ReportRow'
import { useReportFavourites } from '@/lib/reports/favourites'
import { reportMatches } from '@/lib/reports/report-search'
import { cn } from '@/lib/utils'

/**
 * Reports: every file the app can hand to somebody, in one place, a row
 * each, by what it is about — and below each section, greyed out, the ones
 * worth building next. Each row makes a CSV or a PDF from the same data
 * (the PDF carries the farm's logo and colours), and a few also a file of
 * their own (a ZIP of invoices or a shapefile, Markdown for an AI chat).
 *
 * A star on each row puts it in the person's own favourites, and
 * "Favourites" shows only those (Sam, 9 Oct 2026). The list is theirs alone,
 * kept in the database; whether the filter is on is remembered on the device.
 */
const FAV_FILTER_KEY = 'reports-favourites-only'
export function ReportsPage() {
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  const units = useUnitSystem()
  const { viewOff, reports, isAdmin, isManager } = useVisibleReports()

  // ?open=<report id>, from the search bar or a page's link: that report's dialog, already open.
  const [params] = useSearchParams()
  const openId = params.get('open')
  // The rest of the link's query fills in that report's pickers (the field page's ?field=&year=).
  const preset = useMemo(() => Object.fromEntries([...params.entries()].filter(([k]) => k !== 'open')), [params])

  const { data: favs } = useReportFavourites()
  const [favsOnly, setFavsOnlyState] = useState(() => {
    try {
      return localStorage.getItem(FAV_FILTER_KEY) === '1'
    } catch {
      return false
    }
  })
  const setFavsOnly = (on: boolean) => {
    setFavsOnlyState(on)
    try {
      localStorage.setItem(FAV_FILTER_KEY, on ? '1' : '0')
    } catch {
      /* private window: not remembered */
    }
  }
  const favSet = new Set(favs ?? [])
  // The page's own search box: only the reports matching every word typed.
  const [query, setQuery] = useState('')
  const searching = query.trim() !== ''
  const sectionTitle = (key: string) => REPORT_SECTIONS.find((s) => s.key === key)?.title ?? ''
  // A report opened from the search bar shows even when it is not starred.
  const starred = favsOnly ? reports.filter((r) => favSet.has(r.id) || r.id === openId) : reports
  const shown = searching ? starred.filter((r) => reportMatches(query, r, sectionTitle(r.section))) : starred

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

      <div className="relative mt-3 max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          placeholder="Search reports"
          aria-label="Search reports"
          className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-8 text-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        {searching && (
          <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-700">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav aria-label="Report sections" className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setFavsOnly(!favsOnly)}
          aria-pressed={favsOnly}
          className={cn(
            'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium',
            favsOnly ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-gray-200 bg-white text-gray-600 hover:border-amber-300 hover:text-amber-800',
          )}
        >
          <Star className={cn('h-3.5 w-3.5', favsOnly ? 'fill-amber-400 text-amber-500' : 'text-gray-400')} /> Favourites
          {favSet.size > 0 && <span className="tabular-nums text-gray-500">{favSet.size}</span>}
        </button>
        {REPORT_SECTIONS.filter((s) => !(favsOnly || searching) || shown.some((r) => r.section === s.key)).map((s) => (
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

      {searching && !shown.length && (
        <p className="mt-6 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
          No report matches “{query.trim()}”.{' '}
          <button type="button" onClick={() => setQuery('')} className="text-brand-700 underline">
            Clear the search
          </button>
        </p>
      )}

      {favsOnly && !searching && !shown.length && (
        <p className="mt-6 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
          No favourites yet. Tap the <Star className="inline h-3.5 w-3.5 align-[-2px]" /> beside a report to add it, then it shows here.{' '}
          <button type="button" onClick={() => setFavsOnly(false)} className="text-brand-700 underline">
            Show all reports
          </button>
        </p>
      )}

      <div className="mt-5 space-y-6">
        {REPORT_SECTIONS.map((s) => {
          const here = shown.filter((r) => r.section === s.key)
          const ideas = favsOnly ? [] : SUGGESTED_REPORTS.filter((r) => r.section === s.key && !viewOff(r.from.to) && reportMatches(query, r, s.title))
          if (!here.length && !ideas.length) return null
          return (
            <section key={s.key} id={`reports-${s.key}`} className="scroll-mt-4">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{s.title}</h2>
              <ul className="flex flex-col gap-1.5">
                {here.map((r) => {
                  const key = r.id === openId ? `${r.id}:open` : r.id
                  return r.mode === 'build' ? <BuiltRow key={key} r={r} ctx={ctx} autoOpen={r.id === openId} preset={r.id === openId ? preset : undefined} /> : <OpenRow key={key} r={r} autoOpen={r.id === openId} />
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
