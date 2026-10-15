import { admin, json, requireFinance } from './_quickbooks.mts'
import { runQuickbooksSync } from '../shared/quickbooks-sync.ts'
import { readFuelSupplierInvoices } from '../shared/fuel-supplier-qb-read.ts'
import { readIciInvoices } from '../shared/ici-qb-read.ts'
import { readPowerBills } from '../shared/power-bills-qb-read.ts'
import { readGasBills } from '../shared/gas-bills-qb-read.ts'
import { refreshFixedFromBooks, reportFixedBooksError } from '../shared/fixed-costs-books.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Reads the books into the app. Background (15 minutes), because a first read
// of years of bills and their lines is far past a normal function's 30 s.
// Woken nightly by quickbooks-sync-cron with the worker key, after a connect
// by the callback, or by "Sync now" from an owner or finance user.
//
// POST body, optional: { "full": true } re-reads everything.
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  const workerKey = process.env.JOB_WORKER_KEY
  const byKey = Boolean(workerKey) && req.headers.get('x-worker-key') === workerKey
  if (!byKey && !(await requireFinance(req, sb))) return json({ error: 'Not authorised' }, 401)
  const body = ((await req.json().catch(() => null)) ?? {}) as { full?: boolean }
  const started = Date.now()
  const result = await runQuickbooksSync(sb, { full: body.full === true, deadline: started + 13 * 60_000 })
  console.log('[quickbooks-sync]', JSON.stringify(result))
  // Then the Fuel supplier invoice PDFs on any new bills, in the time left: the
  // litres and $/L the books themselves do not hold. Its own heartbeat
  // (fuel_supplier_qb_invoices); a failure here never fails the sync.
  if (result.ok && Date.now() < started + 12 * 60_000) {
    try {
      const fuel = await readFuelSupplierInvoices(sb, { deadline: started + 14 * 60_000 })
      console.log('[quickbooks-sync] fuel supplier invoices:', fuel.detail)
    } catch (e) {
      console.log('[quickbooks-sync] fuel supplier invoices failed:', (e as Error).message)
    }
  }
  // Then ICI's invoice PDFs: the chemical and fertiliser prices, and the field
  // each blend went on (netlify/shared/ici-qb-read.ts). This is the nightly
  // ICI import now; the Gmail-to-Drive path still runs on Sam's machine and
  // whichever gets an invoice first owns it. Its own heartbeat (ici_qb_invoices).
  if (result.ok && Date.now() < started + 12.5 * 60_000) {
    try {
      const ici = await readIciInvoices(sb, { deadline: started + 14 * 60_000 })
      console.log('[quickbooks-sync] ici invoices:', ici.detail)
    } catch (e) {
      console.log('[quickbooks-sync] ici invoices failed:', (e as Error).message)
    }
  }
  // Then the power bills: each site's kWh, demand and charges, for Utilities →
  // Power and the pumps' cost of an inch (netlify/shared/power-bills-qb-read.ts).
  // Last, and only in the time left; its own heartbeat (power_bills_qb).
  if (result.ok && Date.now() < started + 13 * 60_000) {
    try {
      const power = await readPowerBills(sb, { deadline: started + 14.5 * 60_000 })
      console.log('[quickbooks-sync] power bills:', power.detail)
    } catch (e) {
      console.log('[quickbooks-sync] power bills failed:', (e as Error).message)
    }
  }
  // Then the natural gas bills: each site's GJ and charges, for Utilities →
  // Gas (netlify/shared/gas-bills-qb-read.ts). After the power, only in the
  // time left; its own heartbeat (gas_bills_qb).
  if (result.ok && Date.now() < started + 13.5 * 60_000) {
    try {
      const gas = await readGasBills(sb, { deadline: started + 14.6 * 60_000 })
      console.log('[quickbooks-sync] gas bills:', gas.detail)
    } catch (e) {
      console.log('[quickbooks-sync] gas bills failed:', (e as Error).message)
    }
  }
  // Then the farm's fixed expenses from the last twelve months of the books
  // (netlify/shared/fixed-costs-books.ts): once a month in effect, from the
  // 10th, one report call. Its own heartbeat (fixed_costs_books).
  if (result.ok && Date.now() < started + 14 * 60_000) {
    try {
      const fixed = await refreshFixedFromBooks(sb)
      console.log('[quickbooks-sync] fixed costs:', fixed.detail)
    } catch (e) {
      console.log('[quickbooks-sync] fixed costs failed:', (e as Error).message)
      await reportFixedBooksError(sb, e)
    }
  }
  return json(result)
}
