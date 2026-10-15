import { admin, json, requireFinance } from './_quickbooks.mts'
import { readIciInvoices } from '../shared/ici-qb-read.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Reads the ICI invoice PDFs attached in QuickBooks into product_purchases,
// ici_field_lines and the price book (netlify/shared/ici-qb-read.ts). The
// nightly quickbooks-sync-background does this by itself once the books are
// read; this is for reading on demand — a first catch-up, or every invoice
// again after the reading changes.
//
// Background (15 minutes): each PDF is a QuickBooks call and a download.
// Worker key (x-worker-key: JOB_WORKER_KEY) or an owner / finance user.
//
// POST body, optional: { "reread": true } reads every PDF again; { "limit": n }.
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  const workerKey = process.env.JOB_WORKER_KEY
  const byKey = Boolean(workerKey) && req.headers.get('x-worker-key') === workerKey
  if (!byKey && !(await requireFinance(req, sb))) return json({ error: 'Not authorised' }, 401)
  const body = ((await req.json().catch(() => null)) ?? {}) as { reread?: boolean; limit?: number }
  const r = await readIciInvoices(sb, {
    deadline: Date.now() + 13 * 60_000,
    reread: body.reread === true,
    limit: typeof body.limit === 'number' && body.limit > 0 ? Math.floor(body.limit) : undefined,
  })
  console.log('[ici-invoices]', r.detail)
  return json({ ok: r.ok, detail: r.detail, byStatus: r.byStatus, newLines: r.newLines })
}
