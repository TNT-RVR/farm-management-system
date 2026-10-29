import { admin } from './_jd.mts'
import { runHarvestNudges } from '../shared/harvest-nudges.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmTimeIs, farmTimeLabel, type FarmTime } from '../../src/lib/farm-clock.ts'

// Half past seven on the farm's clock: before anybody is out, so the question
// is waiting rather than arriving mid-pass. It is cheap to run out of season —
// a field with no loads is never asked about — so there is no month gate.
const WHEN: FarmTime = { hours: [7] }

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  // Every hour; acts only at its time on the farm's clock (Farm setup's time zone).
  if (!farmTimeIs(WHEN)) return new Response(`Not yet: runs ${farmTimeLabel(WHEN)}`)
  try {
    const r = await runHarvestNudges(admin())
    console.log('Harvest nudges:', JSON.stringify(r))
    return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('Harvest nudges failed:', (e as Error).message)
    return new Response((e as Error).message, { status: 500 })
  }
}

export const config = { schedule: '30 * * * *' }
