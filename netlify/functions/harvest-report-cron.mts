import { admin } from './_jd.mts'
import { runHarvestReports } from '../shared/harvest-report.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmTimeIs, farmTimeLabel, type FarmTime } from '../../src/lib/farm-clock.ts'

// Eight in the morning on the farm's clock: each field marked finished two or
// more days ago sends its season report to its agronomist, once
// (netlify/shared/harvest-report.ts).
const WHEN: FarmTime = { hours: [8] }

export default async () => {
  await hydrateSecrets()
  if (!farmTimeIs(WHEN)) return new Response(`Not yet: runs ${farmTimeLabel(WHEN)}`)
  try {
    const r = await runHarvestReports(admin())
    console.log('Harvest reports:', JSON.stringify(r))
    return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('Harvest reports failed:', (e as Error).message)
    return new Response((e as Error).message, { status: 500 })
  }
}

export const config = { schedule: '15 * * * *' }
