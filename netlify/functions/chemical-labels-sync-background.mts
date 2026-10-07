import { admin, json, requireManager } from './_jd.mts'
import { runLabelsSync } from '../shared/chemical-labels-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Manager-triggered "read all our labels now". Shares its core with
// chemical-labels-sync-cron.mts, which runs monthly — scheduled functions can't
// be called over HTTP, so this is the on-demand path.
// A Netlify background function -- the `-background` filename suffix is what
// makes it one. Reading every label in one pass takes minutes.

let apiKey = process.env.ANTHROPIC_API_KEY
let model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5'

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  apiKey = process.env.ANTHROPIC_API_KEY
  model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5'
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not set' }, 501)
  const sb = admin()
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can read labels' }, 403)
  }
  const result = await runLabelsSync(sb, apiKey, model)
  return json(result, result.ok ? 200 : 502)
}
