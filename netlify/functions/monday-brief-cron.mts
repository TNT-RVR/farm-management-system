import { admin } from './_jd.mts'
import { runMondayBrief } from '../shared/monday-brief.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Mondays at 7 in the morning, Alberta summer time (13:00 UTC).
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  try {
    const r = await runMondayBrief(admin())
    console.log('Monday brief:', JSON.stringify(r))
    return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('Monday brief failed:', (e as Error).message)
    return new Response((e as Error).message, { status: 500 })
  }
}

export const config = { schedule: '0 13 * * 1' }
