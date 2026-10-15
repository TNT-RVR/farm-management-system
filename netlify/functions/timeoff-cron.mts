import type { Config } from '@netlify/functions'
import { admin } from './_jd.mts'
import { syncTimeOff } from '../shared/timeoff-feed.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Who is away, once a day from the time-off calendar. The feed is small and
// changes when a request is approved, which is not hourly.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const sb = admin()
  const result = await syncTimeOff(sb)
  console.log('Time off:', JSON.stringify(result))
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}

export const config: Config = { schedule: '20 12 * * *' }
