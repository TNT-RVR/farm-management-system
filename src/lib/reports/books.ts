import { useMemo } from 'react'
import { canSeeFinances, useAuth } from '@/lib/auth'
import { useQbCompany } from '@/lib/quickbooks'
import { fiscalYear, parseReport, useAccountCategories, useQbReport, type BooksReport, type CategoryOverride } from '@/lib/qb-books'

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
      fy: ReturnType<typeof fiscalYear>
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

/** `cropYear` names the fiscal year (crop year 2026 = Sep 2025 – Aug 2026); null reads nothing. */
export function useReportBooks(cropYear: number | null, o: { balanceSheet?: boolean } = {}): { ready: boolean; books: ReportBooks } {
  const { profile } = useAuth()
  const finance = canSeeFinances(profile)
  const company = useQbCompany()
  const connected = finance && company.data?.status === 'connected'
  const fy = useMemo(() => (cropYear != null ? fiscalYear(cropYear) : null), [cropYear])
  const params = useMemo(() => (fy ? { start_date: fy.start, end_date: fy.end, accounting_method: 'Accrual' } : null), [fy])
  const pl = useQbReport('ProfitAndLoss', connected ? params : null)
  const bs = useQbReport('BalanceSheet', connected && o.balanceSheet ? params : null)
  const overrides = useAccountCategories(connected ? company.data?.realm_id : null)

  const settled = (q: { isSuccess: boolean; isError: boolean }) => q.isSuccess || q.isError
  const ready = !finance || !fy || (settled(company) && (!connected || (settled(pl) && (!o.balanceSheet || settled(bs)) && (settled(overrides) || !company.data?.realm_id))))
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
