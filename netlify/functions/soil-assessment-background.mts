import { admin, json, requireManager } from './_jd.mts'
import { advisorModel } from '../shared/anthropic-reply.ts'
import { runSoilAssessment } from '../shared/soil-assessment-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Manager-triggered agronomic write-up for one soil report.
//
// A background function: one pass produces the narrative, the lb/ac programme
// and a note for every column, which is well past what a normal request should
// hold open.
let apiKey = process.env.ANTHROPIC_API_KEY
// The narrative goes to the advisor model (Opus 5.5); the column notes stay on
// the fast one inside the core.
const model = advisorModel()

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  apiKey = process.env.ANTHROPIC_API_KEY
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not set' }, 501)
  const sb = admin()
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can generate an assessment' }, 403)
  }
  const body = (await req.json().catch(() => ({}))) as { report_id?: string }
  if (!body.report_id) return json({ error: 'report_id required' }, 400)
  try {
    const result = await runSoilAssessment(sb, body.report_id, apiKey, model)
    return json(result, result.ok ? 200 : 502)
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
