import { useMemo } from 'react'
import { isOwner, useAuth } from '@/lib/auth'
import { useVisibleReports } from '@/lib/reports/visible'
import { usePartnerView } from '@/lib/partner-view'
import { farmTz } from '@/lib/farm-context'
import { useUnitSystem } from '@/lib/units'
import type { GatherContext } from '@/lib/reports/framework'
import type { ReportEntry } from '@/lib/reports/catalogue'
import { HARVEST_TAB, REPORT_FAMILIES } from '@/lib/reports/families'
import { BuiltRow, FamilyRow, OpenRow } from '@/pages/reports/ReportRow'

/**
 * Harvest reports → All reports (Sam, 23 Oct 2026; combined 23 Nov): the
 * harvest families from the Reports page, grouped the way harvest uses them.
 * Which families show lives in HARVEST_TAB (families.ts).
 */

/** A partner's: his loads, yields and moisture. The bins, seed and money reports are ours. */
const PARTNER_REPORTS = new Set(['deliveries', 'yield-history', 'yield-vs-estimate', 'moisture-log'])

export function HarvestReportsTab({ cropYear }: { cropYear: number }) {
  const { profile } = useAuth()
  const units = useUnitSystem()
  const { viewOff, reports, isAdmin, isManager } = useVisibleReports()
  const partner = usePartnerView()
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
  const byId = useMemo(() => new Map(reports.map((r) => [r.id, r])), [reports])

  return (
    <div className="space-y-5">
      {HARVEST_TAB.map((g) => {
        const rows = g.families.flatMap(({ id, start }) => {
          const family = REPORT_FAMILIES.find((f) => f.id === id)
          if (!family) return []
          const mine = family.choices
            .filter((c) => !partner || PARTNER_REPORTS.has(c.id))
            .map((c) => byId.get(c.id))
            .filter((r): r is ReportEntry => r != null)
          if (!mine.length) return []
          // One report left (a partner's moisture log): its own row, not a family of one.
          if (mine.length === 1) {
            const r = mine[0]
            return [r.mode === 'build' ? <BuiltRow key={r.id} r={r} ctx={ctx} /> : <OpenRow key={r.id} r={r} />]
          }
          return [<FamilyRow key={family.id} family={family} reports={mine} ctx={ctx} openChoice={start} />]
        })
        if (!rows.length) return null
        return (
          <section key={g.title}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{g.title}</h2>
            <ul className="flex flex-col gap-1.5">{rows}</ul>
          </section>
        )
      })}
    </div>
  )
}
