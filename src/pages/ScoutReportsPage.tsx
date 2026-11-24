import { useMemo } from 'react'
import { PillTabs } from '@/components/PillTabs'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useTab } from '@/lib/useTab'
import { useSearchParams } from 'react-router-dom'
import { isCompanyOf, SCOUT_COMPANIES, scoutCompanies, scoutYears, useScoutReports } from '@/lib/scout-reports'
import { ScoutCompanyTab } from './scout/ScoutCompanyTab'
import { ScoutOverviewTab } from './scout/ScoutOverviewTab'
import { Page } from '@/components/Page'

/**
 * Seed canola scout reports (Sam, 12 Nov 2026).
 *
 * The seed canola companies walk the fields they might contract the summer
 * before and grade them A to D, and the grade decides what we may plant: a
 * field Corteva graded D cannot carry their seed canola next year, however
 * well it fits the rotation. Those grades used to live in an email
 * attachment, which meant the rotation was planned without them and then
 * corrected.
 *
 * A tab a company, because each grades on its own and the sheets arrive
 * separately, and an Overview that puts our fields against all four at once —
 * the only form that answers "where can the seed canola go".
 */
const TABS = ['overview', ...SCOUT_COMPANIES.map((c) => c.key)] as const
type Tab = (typeof TABS)[number]

export function ScoutReportsPage() {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const [tab, setTab] = useTab<Tab>('scout-reports', TABS)
  const [params, setParams] = useSearchParams()
  const { data: rows, isLoading } = useScoutReports()

  const years = useMemo(() => scoutYears(rows ?? []), [rows])
  const asked = Number(params.get('year'))
  const year = years.includes(asked) ? asked : (years[0] ?? new Date().getFullYear() + 1)
  const companies = useMemo(() => scoutCompanies(rows ?? []), [rows])

  const setYear = (y: number) => {
    const next = new URLSearchParams(params)
    next.set('year', String(y))
    setParams(next, { replace: true })
  }

  const forYear = useMemo(() => (rows ?? []).filter((r) => r.crop_year === year), [rows, year])
  const company = companies.find((c) => c.key === tab) ?? companies[0]

  return (
    <Page
      title="Seed canola scout reports"
      className="space-y-3"
      info="Which fields each seed company will grow canola on next year, and why."
      actions={
          years.length > 1 ? (
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
              Crop year
              <select
                className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          ) : years.length === 1 ? (
            <span className="text-xs text-gray-500">Crop year {years[0]}</span>
          ) : null
      }
      tabs={
        <PillTabs
          tabs={[{ key: 'overview' as Tab, label: 'Overview' }, ...companies.map((c) => ({ key: c.key as Tab, label: c.label }))]}
          value={tab}
          onChange={setTab}
        />
      }
    >
      {isLoading ? (
        <p className="p-6 text-sm text-gray-500">Loading…</p>
      ) : tab === 'overview' ? (
        <ScoutOverviewTab year={year} rows={rows ?? []} companies={companies} />
      ) : (
        <ScoutCompanyTab
          company={company}
          year={year}
          rows={forYear.filter((r) => isCompanyOf(company, r.company))}
          isManager={isManager}
        />
      )}
    </Page>
  )
}
