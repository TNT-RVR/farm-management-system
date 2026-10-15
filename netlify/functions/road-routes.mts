import { admin, json, requireManager } from './_jd.mts'
import { runRoadRoutes } from '../shared/road-routes.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// "Check now" on the Distances tab, and what the map calls after a pin is
// dropped or a trail drawn. A moved pin or a new trail is a request or three
// to the router, so this answers inside an ordinary function's time; a
// bigger change (the shop moved: every point again) is done in pieces — the
// answers are cached, so each press carries on where the last stopped, and
// the daily run in road-routes-cron.mts finishes it regardless. The schedule
// lives there because a function that declares one cannot be reached over
// HTTP.
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireManager(req, sb))) return json({ error: 'Managers only' }, 403)
  const force = new URL(req.url).searchParams.get('force') === '1'
  const result = await runRoadRoutes(sb, { force, budgetMs: 7_000 })
  return json(result, result.ok ? 200 : 502)
}
