import { useMemo } from 'react'
import { canSeeFinances, useAuth } from '@/lib/auth'
import { useQbCompany } from '@/lib/quickbooks'
import { parseReport, useAccountCategories, useQbReport, type BooksReport, type CategoryOverride } from '@/lib/qb-books'

/**
 * The real books for a report on the Reports page (the lender package,
 * AgriStability): the fiscal year's Profit and Loss and, when asked, the
 * Balance Sheet at its year end, through /api/quickbooks-report.
 *
 * Owners and the accountant only, and only with QuickBooks connected:
 * anyone else, or a report QuickBooks will not give, gets `note` — one line
 * for the file — and the report is made from the app as before.
 */
export type ReportBooks =
  | { ok: false; note: string }
  | {
      ok: true
      fy: { start: string; end: string; label: string }
      pl: BooksReport
      plFetched: string
      bs: BooksReport | null
      bsFetched: string | null
      /** Why the Balance Sheet is missing when it was asked for. */
      bsNote: string | null
      overrides: Map<string, CategoryOverride>
    }

export const BOOKS_OFF = {
  finance: 'QuickBooks figures: owners and the accountant only.',
  disconnected: 'QuickBooks not connected: figures from the app only.',
} as const

/**
 * The books for one fiscal year (fiscal-year.ts gives it): null reads nothing,
 * undefined is not known yet (Farm setup's year-end still loading), so the
 * report waits rather than reading the wrong months.
 */
export function useReportBooks(period: { start: string; end: string; label: string } | null | undefined, o: { balanceSheet?: boolean } = {}): { ready: boolean; books: ReportBooks } {
  const { profile } = useAuth()
  const finance = canSeeFinances(profile)
  const company = useQbCompany()
  const connected = finance && company.data?.status === 'connected'
  // Keyed on the dates, so a new object with the same year reads nothing again.
  const [start, end, label] = [period?.start, period?.end, period?.label]
  const fy = useMemo(() => (start && end && label ? { start, end, label } : null), [start, end, label])
  const params = useMemo(() => (fy ? { start_date: fy.start, end_date: fy.end, accounting_method: 'Accrual' } : null), [fy])
  const pl = useQbReport('ProfitAndLoss', connected ? params : null)
  const bs = useQbReport('BalanceSheet', connected && o.balanceSheet ? params : null)
  const overrides = useAccountCategories(connected ? company.data?.realm_id : null)

  const settled = (q: { isSuccess: boolean; isError: boolean }) => q.isSuccess || q.isError
  const ready = period !== undefined && (!finance || !fy || (settled(company) && (!connected || (settled(pl) && (!o.balanceSheet || settled(bs)) && (settled(overrides) || !company.data?.realm_id)))))
  const books = useMemo((): ReportBooks => {
    if (!finance) return { ok: false, note: BOOKS_OFF.finance }
    if (!fy || !connected) return { ok: false, note: BOOKS_OFF.disconnected }
    if (pl.error || !pl.data) return { ok: false, note: `QuickBooks did not answer (${(pl.error as Error | null)?.message ?? 'no report'}): figures from the app only.` }
    return {
      ok: true,
      fy,
      pl: parseReport(pl.data.data),
      plFetched: pl.data.fetched_at,
      bs: bs.data ? parseReport(bs.data.data) : null,
      bsFetched: bs.data?.fetched_at ?? null,
      bsNote: o.balanceSheet && !bs.data ? `QuickBooks did not return the balance sheet (${(bs.error as Error | null)?.message ?? 'no report'}).` : null,
      overrides: overrides.data ?? new Map(),
    }
  }, [finance, fy, connected, pl.data, pl.error, bs.data, bs.error, overrides.data, o.balanceSheet])
  return { ready, books }
}
