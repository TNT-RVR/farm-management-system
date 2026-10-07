import { admin, json, requireFinance } from './_quickbooks.mts'
import { runQuickbooksSync } from '../shared/quickbooks-sync.ts'
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
  const result = await runQuickbooksSync(sb, { full: body.full === true, deadline: Date.now() + 13 * 60_000 })
  console.log('[quickbooks-sync]', JSON.stringify(result))
  return json(result)
}
