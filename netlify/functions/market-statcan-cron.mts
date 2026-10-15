import type { Config } from '@netlify/functions'
import { admin } from './_jd.mts'
import { runStatcanSync } from '../shared/market-statcan.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// StatCan publishes this monthly, around the third week. Weekly is plenty, and
// the upsert makes a re-run that finds nothing new cost nothing.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const sb = admin()
  const result = await runStatcanSync(sb)
  console.log('StatCan market sync:', JSON.stringify(result))
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}

export const config: Config = { schedule: '30 6 * * 1' }
