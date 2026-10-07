import { admin, json, requireManager } from './_jd.mts'
import { advisorModel } from '../shared/anthropic-reply.ts'
import { runAssessmentSweep } from '../shared/soil-assessment-sweep.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// "Write everything that is missing or stale" — woken hourly by the cron, or
// by a manager.
//
// Background, because a full season is dozens of model calls. The schedule
// lives in soil-assessment-sweep-cron.mts, NOT here — a function declaring one
// cannot also be reached over HTTP.
let apiKey = process.env.ANTHROPIC_API_KEY
// The narrative goes to the advisor model (Opus 5.5); the column notes stay on
// the fast one inside the core.
const model = advisorModel()
let workerKey = process.env.JOB_WORKER_KEY

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  apiKey = process.env.ANTHROPIC_API_KEY
  workerKey = process.env.JOB_WORKER_KEY
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not set' }, 501)
  const sb = admin()
  // The hourly cron wakes this with the shared worker key; a manager can run
  // it from the page. Never trusted on the absence of a credential.
  const byKey = !!workerKey && req.headers.get('x-worker-key') === workerKey
  if (!byKey && !(await requireManager(req, sb))) {
    // A background function answers 202 the moment it is accepted, so this 403
    // never reaches the browser — the button would just flash and settle back
    // with nothing to show for it. Record the refusal where the page can read
    // it, so "nothing happened" becomes "you are not a manager".
    await sb.rpc('record_integration_heartbeat', {
      p_key: 'soil_assessments',
      p_detail: 'REFUSED: the signed-in account is not an active manager, so nothing was written.',
      p_data_at: null,
    })
    return json({ error: 'Only active managers can run the assessment sweep' }, 403)
  }
  const result = await runAssessmentSweep(sb, apiKey, model)
  return json(result, result.ok ? 200 : 502)
}
