import { admin, json, requireManager } from './_jd.mts'
import { extractPendingGrazingRules } from '../shared/grazing-rules-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Reads every label's grazing / feeding / slaughter / dairy restrictions into
// chemical_grazing_rules (netlify/shared/grazing-rules-core.ts).
//
// Works through the labels not read yet, re-read since, or corrected by hand
// since (all of them with ?force=1), within a 13-minute budget, then starts
// itself again if any are left. Started with the worker key, or by a manager.
// The daily grazing watch reads new labels itself; this is the bulk run.
let apiKey = process.env.ANTHROPIC_API_KEY
let model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'
let workerKey = process.env.JOB_WORKER_KEY

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  apiKey = process.env.ANTHROPIC_API_KEY
  model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'
  workerKey = process.env.JOB_WORKER_KEY
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set' }, 500)
  const sb = admin()
  const byKey = !!workerKey && req.headers.get('x-worker-key') === workerKey
  if (!byKey && !(await requireManager(req, sb))) return json({ error: 'Not authorised' }, 401)

  const force = new URL(req.url).searchParams.get('force') === '1'
  const r = await extractPendingGrazingRules(sb, apiKey, model, { force, budgetMs: 13 * 60_000 })

  // More to do: start another run rather than stop half way. Not after a
  // forced run, which would read everything again.
  if (r.remaining > 0 && !force && workerKey && process.env.URL) {
    await fetch(`${process.env.URL}/.netlify/functions/grazing-rules-extract-background`, { method: 'POST', headers: { 'x-worker-key': workerKey } }).catch(() => {})
  }
  console.log('grazing rules extract:', JSON.stringify(r))
  return json(r)
}
