import { admin, json, qbAccess, qbGet, requireFinance } from './_quickbooks.mts'
import { hydrateSecrets } from '../shared/secrets.ts'

// One of QuickBooks' own reports — Profit and Loss, Balance Sheet, aged
// payables and receivables — for the screens built on the real books (fixed
// expenses, the lender package, AgriStability, cash flow). The synced lines
// miss payroll; the reports don't.
//
// A copy is kept in qb_report_cache, so opening a screen twice asks
// QuickBooks once; "refresh" asks again. A copy older than six hours is asked
// for again on its own.
//
// Owners and the farm's accountant only (requireFinance = can_see_finances).
//
// POST { report, params?, refresh? }  →  { report, params, fetched_at, data }

const REPORTS = new Set(['ProfitAndLoss', 'BalanceSheet', 'AgedPayables', 'AgedReceivables', 'CashFlow', 'TrialBalance'])
const PARAMS = new Set(['start_date', 'end_date', 'accounting_method', 'summarize_column_by', 'date_macro', 'report_date', 'aging_period', 'num_periods'])
const FRESH_MS = 6 * 3600_000

export default async (req: Request) => {
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireFinance(req, sb))) return json({ error: 'Only the owners and the farm’s accountant can see the books' }, 403)

  const body = ((await req.json().catch(() => null)) ?? {}) as { report?: string; params?: Record<string, unknown>; refresh?: boolean }
  const report = String(body.report ?? '')
  if (!REPORTS.has(report)) return json({ error: 'Unknown report' }, 400)
  // The same parameters in the same order are the same copy.
  const params = new URLSearchParams()
  for (const k of Object.keys(body.params ?? {}).sort()) {
    const v = body.params![k]
    if (PARAMS.has(k) && v != null && /^[\w-]{1,40}$/.test(String(v))) params.set(k, String(v))
  }
  const key = params.toString()

  const { data: acct } = await sb.from('integration_accounts').select('status, external_org_id').eq('provider', 'quickbooks').single()
  const realm = acct?.external_org_id as string | undefined
  if (acct?.status !== 'connected' || !realm) return json({ error: 'QuickBooks is not connected' }, 409)

  if (!body.refresh) {
    const { data: kept } = await sb.from('qb_report_cache').select('data, fetched_at').eq('realm_id', realm).eq('report', report).eq('params', key).maybeSingle()
    if (kept && Date.now() - new Date(kept.fetched_at as string).getTime() < FRESH_MS) {
      return json({ report, params: key, fetched_at: kept.fetched_at, data: kept.data })
    }
  }
  try {
    const a = await qbAccess(sb)
    const data = await qbGet<Record<string, unknown>>(a, `reports/${report}${key ? `?${key}` : ''}`)
    const fetched_at = new Date().toISOString()
    await sb.from('qb_report_cache').upsert({ realm_id: realm, report, params: key, data, fetched_at }, { onConflict: 'realm_id,report,params' })
    return json({ report, params: key, fetched_at, data })
  } catch (e) {
    return json({ error: `QuickBooks did not return the report: ${(e as Error).message.slice(0, 300)}` }, 502)
  }
}
