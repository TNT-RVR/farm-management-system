import { admin } from './_jd.mts'
import { runLeaseReminders } from '../shared/lease-reminders.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmTimeIs, farmTimeLabel, type FarmTime } from '../../src/lib/farm-clock.ts'

// Every morning at 8 on the farm's clock.
const WHEN: FarmTime = { hours: [8] }

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  // Every hour; acts only at its time on the farm's clock (Farm setup's time zone).
  if (!farmTimeIs(WHEN)) return new Response(`Not yet: runs ${farmTimeLabel(WHEN)}`)
  try {
    const r = await runLeaseReminders(admin())
    console.log('Lease reminders:', JSON.stringify(r))
    return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('Lease reminders failed:', (e as Error).message)
    return new Response((e as Error).message, { status: 500 })
  }
}

export const config = { schedule: '0 * * * *' }
