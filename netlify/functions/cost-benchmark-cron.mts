import type { Config } from '@netlify/functions'
import { admin } from './_jd.mts'
import { runBenchmarkRefresh } from '../shared/cost-benchmarks.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// The farm input price index is quarterly, so this is too — a weekly run would
// re-fetch the same numbers fifty times a year to change nothing.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const sb = admin()
  const result = await runBenchmarkRefresh(sb)
  console.log('Cost benchmark refresh:', JSON.stringify(result))
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}

export const config: Config = { schedule: '0 7 5 1,4,7,10 *' }
