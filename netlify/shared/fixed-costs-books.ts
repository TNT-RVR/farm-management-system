import type { SupabaseClient } from '@supabase/supabase-js'
import { qbAccess, qbGet } from '../functions/_quickbooks.mts'
import { fixedFromBooks, parseReport, partNote, type CategoryOverride, type BooksCategory } from '../../src/lib/qb-books-core.ts'
import { powerByUse } from '../../src/lib/irrigation-power-core.ts'
import type { BillSiteRow } from '../../src/lib/power-bills-core.ts'
import { lastTwelveMonths, targetYears } from '../../src/lib/fixed-books-window.ts'

/**
 * The farm's fixed expenses, kept current from the books (Sam, 14 Oct 2026:
 * "calculate based on the last 12 months of overall costs to RVR and update
 * that once per month").
 *
 * Reads QuickBooks' Profit and Loss for the last twelve full months and puts
 * it through the same rules as Financials → Farm costs → From the books
 * (fixedFromBooks): cash only, so no depreciation; the management fee off
 * labour and overhead; the crops' share of each part. The result is written to
 * the crop year being planned (from 1 August, next year's) and, the month
 * after a fiscal year closes (Farm setup's year-end), to the crop that year
 * paid for as well, so it ends on its own finished books.
 *
 * Runs after the nightly QuickBooks sync. Monthly in effect: a year already
 * read from the same twelve months is skipped, and nothing runs before the
 * 10th, so last month's bills are in. A year an owner saved by hand
 * (books_auto off) is never touched. Reports to integration_health
 * 'fixed_costs_books'.
 */

export const HEALTH_KEY = 'fixed_costs_books'
const PARTS = ['land', 'labour', 'machinery', 'overhead'] as const
export type FixedBooksResult = { ok: boolean; detail: string; years: { year: number; perAcre: number | null; skipped?: string }[] }

export async function refreshFixedFromBooks(sb: SupabaseClient, opts: { force?: boolean; today?: Date } = {}): Promise<FixedBooksResult> {
  const today = opts.today ?? new Date()
  const window = lastTwelveMonths(today)
  if (!opts.force && today.getUTCDate() < 10) return { ok: true, detail: 'Waits for the 10th', years: [] }

  const years = targetYears(today, window)
  const { data: rows, error: rowsErr } = await sb.from('farm_fixed_costs').select('crop_year, books_auto, books_window, books_crop_share, note').order('crop_year')
  if (rowsErr) throw rowsErr
  const byYear = new Map((rows ?? []).map((r) => [r.crop_year as number, r]))
  const latest = (rows ?? []).at(-1)
  const out: FixedBooksResult['years'] = []
  const todo: number[] = []
  for (const y of years) {
    const r = byYear.get(y)
    if (r && !r.books_auto) out.push({ year: y, perAcre: null, skipped: 'set by hand' })
    else if (r && r.books_window === window.label && !opts.force) out.push({ year: y, perAcre: null, skipped: 'already read from these months' })
    else todo.push(y)
  }
  if (!todo.length) return { ok: true, detail: `Nothing to do (${out.map((o) => `${o.year}: ${o.skipped}`).join('; ')})`, years: out }

  // The Profit and Loss for the twelve months, kept in the same cache the screens read.
  const a = await qbAccess(sb)
  const params = new URLSearchParams({ accounting_method: 'Accrual', end_date: window.end, start_date: window.start })
  const report = await qbGet<Record<string, unknown>>(a, `reports/ProfitAndLoss?${params}`)
  await sb.from('qb_report_cache').upsert({ realm_id: a.realmId, report: 'ProfitAndLoss', params: params.toString(), data: report, fetched_at: new Date().toISOString() }, { onConflict: 'realm_id,report,params' })

  const { data: cats, error: catErr } = await sb.from('qb_account_categories').select('account_id, category, account_name, note').eq('realm_id', a.realmId)
  if (catErr) throw catErr
  const overrides = new Map((cats ?? []).map((c) => [c.account_id as string, { ...c, category: c.category as BooksCategory } as CategoryOverride]))

  // The power bills replace the books' electricity once they cover all twelve months.
  const sites: BillSiteRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('power_bill_sites').select('*').range(from, from + 999)
    if (error) throw error
    sites.push(...((data ?? []) as BillSiteRow[]))
    if (!data || data.length < 1000) break
  }
  const power = powerByUse(sites, window.start, window.end)
  const overheadPower = power.months.size >= 12 ? power.overhead : null

  const parsed = parseReport(report)
  const now = new Date().toISOString()
  for (const year of todo) {
    const share = Number(byYear.get(year)?.books_crop_share ?? latest?.books_crop_share ?? 82)
    const books = fixedFromBooks(parsed, overrides, { cropShare: share / 100, takeOffFee: true, overheadPower })
    const { data: acres, error: acresErr } = await sb.rpc('farm_plan_acres', { p_year: year })
    if (acresErr) throw acresErr
    const spread = Number(acres) > 0 ? Math.round(Number(acres) * 100) / 100 : null
    const { error: headErr } = await sb.from('farm_fixed_costs').upsert(
      {
        crop_year: year,
        mode: 'breakdown',
        spread_acres: spread,
        books_auto: true,
        books_crop_share: share,
        books_window: window.label,
        books_updated_at: now,
        note: byYear.get(year)?.note ?? null,
        updated_by: null,
        updated_at: now,
      },
      { onConflict: 'crop_year' },
    )
    if (headErr) throw headErr
    const fee = (k: (typeof PARTS)[number]) => (books.parts[k].fee ? `, less ${books.parts[k].fee.toFixed(2)} of the management fee` : '')
    const lines = PARTS.filter((k) => books.parts[k].accounts.length).map((k) => ({
      crop_year: year,
      category: k,
      basis: 'farm_total',
      amount: books.parts[k].crops,
      note: `${partNote(books.parts[k].accounts, window.label)}${fee(k)}; crops' share ${Math.round(share)}% (updated monthly)`,
      updated_by: null,
      updated_at: now,
    }))
    if (lines.length) {
      const { error } = await sb.from('farm_fixed_cost_lines').upsert(lines, { onConflict: 'crop_year,category' })
      if (error) throw error
    }
    // Cash only: no depreciation line, and no part the books no longer have.
    const keep = new Set(lines.map((l) => l.category))
    const drop = ['land', 'labour', 'machinery', 'overhead', 'depreciation'].filter((k) => !keep.has(k as (typeof PARTS)[number]))
    if (drop.length) {
      const { error } = await sb.from('farm_fixed_cost_lines').delete().eq('crop_year', year).in('category', drop)
      if (error) throw error
    }
    // Saving the lines re-worked the figure; read it back.
    const { data: head } = await sb.from('farm_fixed_costs').select('per_acre').eq('crop_year', year).single()
    out.push({ year, perAcre: head?.per_acre == null ? null : Number(head.per_acre) })
  }
  const written = out.filter((o) => !o.skipped)
  const detail = `${window.label}: ${written.map((o) => `${o.year} $${o.perAcre?.toFixed(2) ?? '?'}/ac`).join(', ')}${overheadPower == null ? '' : ' · power from the bills'}`
  await sb.rpc('record_integration_heartbeat', { p_key: HEALTH_KEY, p_detail: detail, p_data_at: `${window.end}T23:59:59Z` })
  return { ok: true, detail, years: out }
}

/** Mark the job failed on the health panel, without touching when it last worked. */
export async function reportFixedBooksError(sb: SupabaseClient, e: unknown) {
  const now = new Date().toISOString()
  await sb
    .from('integration_health')
    .update({ status: 'error', detail: (e as Error).message.slice(0, 300), last_checked_at: now, updated_at: now })
    .eq('source_key', HEALTH_KEY)
    .eq('enabled', true)
}
