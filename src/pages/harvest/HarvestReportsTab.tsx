import { useMemo } from 'react'
import { isOwner, useAuth } from '@/lib/auth'
import { useVisibleReports } from '@/lib/reports/visible'
import { farmTz } from '@/lib/farm-context'
import { useUnitSystem } from '@/lib/units'
import type { GatherContext } from '@/lib/reports/framework'
import { BuiltRow, OpenRow } from '@/pages/reports/ReportRow'

/**
 * Harvest reports → All reports (Sam, 23 Oct 2026): the harvest downloads in one place,
 * the same rows as the Reports page (and the same permissions), grouped the
 * way harvest uses them. A report lives in the catalogue once; this only
 * picks which ones show here.
 */
const GROUPS: { title: string; ids: string[] }[] = [
  {
    title: 'Bin monitoring',
    ids: [
      'bin-temperature-record',
      'aeration',
      'bin-records',
    ],
  },
  {
    title: 'Seed reports',
    ids: [
      'seed-production-report',
      'seed-canola-records',
    ],
  },
  {
    title: 'Loads, yields and deliveries',
    ids: ['deliveries', 'yield-history', 'yield-vs-estimate', 'afsc-production', 'moisture-log', 'grain-inventory', 'driver-log', 'trucking', 'checkoff-refunds'],
  },
]

/** Every report id this tab shows, for the test that keeps them in the catalogue. */
export const HARVEST_REPORT_IDS = GROUPS.flatMap((g) => g.ids)

export function HarvestReportsTab({ cropYear }: { cropYear: number }) {
  const { profile } = useAuth()
  const units = useUnitSystem()
  const { viewOff, reports, isAdmin, isManager } = useVisibleReports()
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
    <div className="space-y-5">
      {GROUPS.map((g) => {
        const here = g.ids.map((id) => reports.find((r) => r.id === id)).filter((r) => r != null)
        if (!here.length) return null
        return (
          <section key={g.title}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{g.title}</h2>
            <ul className="flex flex-col gap-1.5">
              {here.map((r) => (r.mode === 'build' ? <BuiltRow key={r.id} r={r} ctx={ctx} /> : <OpenRow key={r.id} r={r} />))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
