import { admin, json, requireFinance } from './_quickbooks.mts'
import { refreshFixedFromBooks, reportFixedBooksError } from '../shared/fixed-costs-books.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Financials → Farm costs → "Update from QuickBooks now": the monthly fixed
// expenses read (netlify/shared/fixed-costs-books.ts) on demand, whatever the
// date. Owners and the farm's accountant only, or the worker key.
//
// POST {}  →  { ok, detail, years }

export default async (req: Request) => {
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  const workerKey = process.env.JOB_WORKER_KEY
  const byKey = Boolean(workerKey) && req.headers.get('x-worker-key') === workerKey
  if (!byKey && !(await requireFinance(req, sb))) return json({ error: 'Only the owners and the farm’s accountant can update the fixed costs' }, 403)
  try {
    return json(await refreshFixedFromBooks(sb, { force: true }))
  } catch (e) {
    await reportFixedBooksError(sb, e)
    return json({ error: `Could not read the books: ${(e as Error).message.slice(0, 300)}` }, 502)
  }
}
