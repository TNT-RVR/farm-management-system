import type { Config } from '@netlify/functions'
import { admin } from './_jd.mts'
import { runFuelMarketSync } from '../shared/market-fuel.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// NRCan's weekly pump price is an average that fills in day by day through
// the week, so it is read daily: the week in progress moves, and the upsert
// on the date keeps the latest reading of it. Four small RSS requests.
//
// The schedule lives here and NOT on the -sync sibling: a function declaring
// one cannot also be reached over HTTP.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const result = await runFuelMarketSync(admin())
  console.log('Fuel market sync:', JSON.stringify(result))
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}

// 15:30 UTC, mid-morning at the ranch.
export const config: Config = { schedule: '30 15 * * *' }
