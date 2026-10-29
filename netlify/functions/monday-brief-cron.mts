import { admin } from './_jd.mts'
import { runMondayBrief } from '../shared/monday-brief.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmTimeIs, farmTimeLabel, type FarmTime } from '../../src/lib/farm-clock.ts'

// Mondays at 7 in the morning on the farm's clock.
const WHEN: FarmTime = { hours: [7], weekday: 1 }

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  // Every hour; acts only at its time on the farm's clock (Farm setup's time zone).
  if (!farmTimeIs(WHEN)) return new Response(`Not yet: runs ${farmTimeLabel(WHEN)}`)
  try {
    const r = await runMondayBrief(admin())
    console.log('Monday brief:', JSON.stringify(r))
    return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('Monday brief failed:', (e as Error).message)
    return new Response((e as Error).message, { status: 500 })
  }
}

export const config = { schedule: '0 * * * *' }
