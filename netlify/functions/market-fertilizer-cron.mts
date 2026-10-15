import type { Config } from '@netlify/functions'
import { admin } from './_jd.mts'
import { runFertilizerMarketSync } from '../shared/market-fertilizer.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// StatCan publishes the farm input index quarterly. Weekly is plenty, and the
// upsert makes a run that finds nothing new cost nothing.
//
// The schedule lives here and NOT on the -sync sibling: a function declaring
// one cannot also be reached over HTTP.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const sb = admin()
  const result = await runFertilizerMarketSync(sb)
  console.log('Fertilizer market sync:', JSON.stringify(result))
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}

export const config: Config = { schedule: '45 6 * * 1' }
