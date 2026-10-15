import type { Config } from '@netlify/functions'
import { admin } from './_jd.mts'
import { runSmridStaffCheck } from '../shared/smrid-staff-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmFeatureOn } from '../../src/lib/farm-context.ts'

// Confirms the SMRID water coordinators on the 1st of each month. Monthly rather
// than once each April because the directory itself carries mid-season changes
// (one area lists a number that switches on 15 May), and a yearly check would
// also hide a broken scrape for eleven months. Managers are notified only if a
// coordinator changed on an area we actually farm.
//
// Scheduled functions cannot be invoked over HTTP — a 403 here is the schedule
// confirming itself. Use smrid-staff-check.mts to run it on demand.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  // Switched off in Farm setup (or a fresh install that has not turned it on).
  if (!farmFeatureOn('district_allotment')) return new Response('Irrigation district allotment is switched off in Farm setup', { status: 200 })
  const sb = admin()
  const result = await runSmridStaffCheck(sb)
  console.log('SMRID staff check:', JSON.stringify(result))
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  })
}

// 1st of every month, 14:00 UTC (08:00 MDT in summer, 07:00 MST in winter).
export const config: Config = { schedule: '0 14 1 * *' }
