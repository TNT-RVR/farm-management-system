import { admin, json, requireManager } from './_jd.mts'
import { extractPendingGrazingRules } from '../shared/grazing-rules-core.ts'
import { runGrazingWatch } from '../shared/grazing-watch.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Sprays that keep livestock off a field: reads any new or changed label's
// grazing rules first, then tells the managers about new sprays on ground
// livestock eat from and about cattle inside a restriction
// (netlify/shared/grazing-watch.ts).
//
// Background, because a new label is a Claude call and a scheduled function
// has thirty seconds. Woken daily by grazing-watch-cron.mts and after each
// John Deere operations sync; a manager can run it too. { "dryRun": true }
// returns what it would send and writes nothing.
let apiKey = process.env.ANTHROPIC_API_KEY
let model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'
let workerKey = process.env.JOB_WORKER_KEY

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  apiKey = process.env.ANTHROPIC_API_KEY
  model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'
  workerKey = process.env.JOB_WORKER_KEY
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  const byKey = !!workerKey && req.headers.get('x-worker-key') === workerKey
  if (!byKey && !(await requireManager(req, sb))) return json({ error: 'Not authorised' }, 401)
  const body = (await req.json().catch(() => null)) as { dryRun?: boolean } | null
  const dryRun = body?.dryRun === true

  let labels = ''
  if (apiKey && !dryRun) {
    try {
      const r = await extractPendingGrazingRules(sb, apiKey, model, { budgetMs: 8 * 60_000 })
      if (r.read || r.failed) labels = ` · labels read ${r.read}${r.failed ? `, ${r.failed} failed` : ''}`
    } catch (e) {
      labels = ` · label read failed: ${(e as Error).message}`
    }
  }
  try {
    const r = await runGrazingWatch(sb, { dryRun })
    console.log('[grazing-watch] ' + r.detail + labels)
    return json({ ok: true, detail: r.detail + labels, notices: dryRun ? r.notices : r.notices.length })
  } catch (e) {
    console.error('[grazing-watch] ' + (e as Error).message)
    return json({ ok: false, error: (e as Error).message }, 500)
  }
}
