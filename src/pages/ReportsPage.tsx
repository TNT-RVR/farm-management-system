import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FolderOpen, Search, Star, X } from 'lucide-react'
import { isOwner, useAuth } from '@/lib/auth'
import { useVisibleReports } from '@/lib/reports/visible'
import { farmTz } from '@/lib/farm-context'
import { useCropYear } from '@/lib/crop-year'
import { useUnitSystem } from '@/lib/units'
import { REPORT_SECTIONS, SUGGESTED_REPORTS } from '@/lib/reports/catalogue'
import type { GatherContext } from '@/lib/reports/framework'
import { BuiltRow, FamilyRow, OpenRow } from '@/pages/reports/ReportRow'
import { REPORT_ALIASES, REPORT_FAMILIES, familyOf, type ReportFamily } from '@/lib/reports/families'
import type { ReportEntry } from '@/lib/reports/catalogue'
import { MADE_REPORTS_LINK } from '@/lib/made-reports'
import { useReportFavourites } from '@/lib/reports/favourites'
import { reportMatches } from '@/lib/reports/report-search'
import { cn } from '@/lib/utils'
import { Page } from '@/components/Page'

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
 *
 * Reports off the same data are one row (Sam, 23 Nov 2026): the row's form
 * asks who it is going to, or which report, then the rest (families.ts). Every
 * file made here is also kept under Documents → Made reports.
 */

/** A row on the page: a family of reports, or a report on its own. */
type Row = { kind: 'family'; family: ReportFamily; reports: ReportEntry[] } | { kind: 'one'; report: ReportEntry }
const rowId = (r: Row) => (r.kind === 'family' ? r.family.id : r.report.id)
const rowSection = (r: Row) => (r.kind === 'family' ? r.family.section : r.report.section)
const FAV_FILTER_KEY = 'reports-favourites-only'
export function ReportsPage() {
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  const units = useUnitSystem()
  const { viewOff, reports, isAdmin, isManager } = useVisibleReports()

  // ?open=<report id>, from the search bar or a page's link: that report's dialog, already open.
  const [params] = useSearchParams()
  const asked = params.get('open')
  const openId = asked ? (REPORT_ALIASES[asked] ?? asked) : null
  // An old link names one report; it opens the family that report is now in, on that report.
  const openFamily = openId ? (REPORT_FAMILIES.find((f) => f.id === openId) ?? familyOf(openId)) : undefined
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
  // The rows: each family with the reports in it this person may make, then the reports in none.
  const rows = useMemo<Row[]>(() => {
    const byId = new Map(reports.map((r) => [r.id, r]))
    const inFamily = new Set<string>()
    const out: Row[] = []
    for (const family of REPORT_FAMILIES) {
      const mine = family.choices.map((c) => byId.get(c.id)).filter((r): r is ReportEntry => !!r)
      for (const c of family.choices) inFamily.add(c.id)
      if (mine.length) out.push({ kind: 'family', family, reports: mine })
    }
    for (const r of reports) if (!inFamily.has(r.id)) out.push({ kind: 'one', report: r })
    return out
  }, [reports])
  const isOpened = (r: Row) => (r.kind === 'family' ? r.family.id === openFamily?.id : r.report.id === openId)
  const isStarred = (r: Row) => (r.kind === 'family' ? [r.family.id, ...r.family.choices.map((c) => c.id)].some((id) => favSet.has(id)) : favSet.has(r.report.id))
  // A family matches on its own words, or on any of its reports' names and lines.
  const matches = (r: Row) =>
    r.kind === 'one'
      ? reportMatches(query, r.report, sectionTitle(r.report.section))
      : reportMatches(query, { name: r.family.name, what: [r.family.what, ...r.reports.map((x) => `${x.name} ${x.what} ${x.from.label}`), ...r.family.choices.map((c) => c.label)].join(' '), section: r.family.section }, sectionTitle(r.family.section))
  // A report opened from the search bar shows even when it is not starred.
  const starred = favsOnly ? rows.filter((r) => isStarred(r) || isOpened(r)) : rows
  const shown = searching ? starred.filter(matches) : starred

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
    <Page
      title="Reports"
      info="Press Download, choose who it is for or which report, then the year, field and the rest. Every file made is kept under Documents → Made reports."
      actions={
        <Link to={MADE_REPORTS_LINK} className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-brand-300 hover:text-brand-800">
          <FolderOpen className="h-3.5 w-3.5" /> Made reports
        </Link>
      }
    >
      <div className="relative max-w-md">
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
        {REPORT_SECTIONS.filter((s) => !(favsOnly || searching) || shown.some((r) => rowSection(r) === s.key)).map((s) => (
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
          const here = shown.filter((r) => rowSection(r) === s.key)
          const ideas = favsOnly ? [] : SUGGESTED_REPORTS.filter((r) => r.section === s.key && !viewOff(r.from.to) && reportMatches(query, r, s.title))
          if (!here.length && !ideas.length) return null
          return (
            <section key={s.key} id={`reports-${s.key}`} className="scroll-mt-4">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{s.title}</h2>
              <ul className="flex flex-col gap-1.5">
                {here.map((row) => {
                  const opened = isOpened(row)
                  const key = opened ? `${rowId(row)}:open` : rowId(row)
                  if (row.kind === 'family')
                    return <FamilyRow key={key} family={row.family} reports={row.reports} ctx={ctx} autoOpen={opened} openChoice={opened ? (openId ?? undefined) : undefined} preset={opened ? preset : undefined} />
                  const r = row.report
                  return r.mode === 'build' ? <BuiltRow key={key} r={r} ctx={ctx} autoOpen={opened} preset={opened ? preset : undefined} /> : <OpenRow key={key} r={r} autoOpen={opened} />
                })}
                {ideas.map((r) => (
                  <li key={r.name} className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-1.5">
                    <span className="text-sm font-medium text-gray-500">{r.name}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-gray-400" title={r.what}>
                      {r.what}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Not built yet</span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </Page>
  )
}
