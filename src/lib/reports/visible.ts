import { useMemo } from 'react'
import { canSeeFinances, hasAdminAccess, hasManagerAccess, useAuth } from '@/lib/auth'
import { isViewDenied } from '@/lib/nav'
import { isPathOff, useDisabledPaths } from '@/lib/farm-setup'
import { REPORTS } from './catalogue'

const bare = (to: string) => to.split('?')[0]

/**
 * What this person may see: `viewOff` says whether a page is switched off
 * for the farm or closed to them, and `reports` is the catalogue cut to the
 * ones they can make — a report is visible exactly when the page its data
 * comes from is, and its role rule allows. Shared by Reports and the search.
 */
export function useVisibleReports() {
  const { profile } = useAuth()
  const disabled = useDisabledPaths()
  const isAdmin = hasAdminAccess(profile?.role)
  const isManager = hasManagerAccess(profile?.role)
  const finances = canSeeFinances(profile)
  const viewOff = useMemo(() => (path: string) => isPathOff(disabled, bare(path)) || isViewDenied(profile, bare(path)), [disabled, profile])
  const reports = useMemo(
    () => REPORTS.filter((r) => !viewOff(r.from.to) && (!r.adminOnly || isAdmin) && (!r.managerOnly || isManager) && (!r.financeOnly || finances)),
    [viewOff, isAdmin, isManager, finances],
  )
  return { viewOff, reports, isAdmin, isManager }
}
