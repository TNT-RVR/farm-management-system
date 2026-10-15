import { admin, requireManager } from './_jd.mts'
import { syncRepro } from '../shared/eshepherd-repro.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Pulls eShepherd's pregnancy model (about 7 MB, 8 s, and growing through the
// season) — too long for an ordinary function, so it runs in the background.
// Started every Monday by eshepherd-repro-cron (worker key) or by "Refresh
// now" on the Pregnancy tab (an active manager).
let workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
  const sb = admin()
  const byWorker = Boolean(workerKey) && req.headers.get('x-worker-key') === workerKey
  if (!byWorker && !(await requireManager(req, sb))) return new Response('Forbidden', { status: 403 })
  await syncRepro(sb)
  return new Response('ok')
}
