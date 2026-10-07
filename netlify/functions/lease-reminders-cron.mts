import { admin } from './_jd.mts'
import { runLeaseReminders } from '../shared/lease-reminders.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Every morning at 8, Alberta summer time (14:00 UTC).
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  try {
    const r = await runLeaseReminders(admin())
    console.log('Lease reminders:', JSON.stringify(r))
    return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('Lease reminders failed:', (e as Error).message)
    return new Response((e as Error).message, { status: 500 })
  }
}

export const config = { schedule: '0 14 * * *' }
