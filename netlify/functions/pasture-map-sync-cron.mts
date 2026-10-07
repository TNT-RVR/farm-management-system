import type { Config } from '@netlify/functions'
import { admin } from './_jd.mts'
import { runPastureMapSync } from '../shared/pasture-map-sync.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Once a day: pastures drawn or redrawn on the farm's My Map reach the app,
// and the satellite starts reading a new one at its next pass.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const result = await runPastureMapSync(admin())
  console.log('Pasture map sync:', JSON.stringify(result))
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}

export const config: Config = { schedule: '20 12 * * *' }
