import { admin } from './_jd.mts'
import { syncWaterDaily } from '../shared/water-daily.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmFeatureOn } from '../../src/lib/farm-context.ts'

// Every morning: yesterday's reservoir levels and snowpacks, as daily means,
// for the Season ahead panel and its graphs. Ten days back so a missed run
// fills itself in. Eight small fetches — inside the thirty seconds.
export const config = { schedule: '30 13 * * *' }

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  // The reservoirs and snowpacks are the original farm's district's; a farm that
  // has not switched its district on has none of its own here yet.
  if (!farmFeatureOn('district_allotment')) return new Response('Irrigation district is switched off in Farm setup', { status: 200 })
  const r = await syncWaterDaily(admin(), 10, 10)
  return new Response(`${r.rows} station-days${r.failed.length ? `; failed: ${r.failed.join('; ')}` : ''}`, { status: 200 })
}
