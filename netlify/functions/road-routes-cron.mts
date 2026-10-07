import type { Config } from '@netlify/functions'
import { admin } from './_jd.mts'
import { runRoadRoutes } from '../shared/road-routes.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Once a day: every route rebuilt from the cached router answers, asking the
// router only about points it has not seen (a re-drawn boundary, a moved pin,
// a new trail). Nothing moved is a few reads and no requests, well inside a
// scheduled function's thirty seconds; a big change finishes over a few runs.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const result = await runRoadRoutes(admin(), { budgetMs: 20_000 })
  console.log('Road routes:', JSON.stringify(result))
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}

export const config: Config = { schedule: '40 9 * * *' }
