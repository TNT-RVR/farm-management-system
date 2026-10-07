import type { Config } from '@netlify/functions'
import { admin } from './_jd.mts'
import { inSeason, shouldRunToday } from '../shared/sat-ingest.ts'
import { runPastureIngest } from '../shared/sat-run.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// The pastures, on their own clock.
//
// In the full run the pastures come after every field, under one shared
// twenty-second budget — and by the time the fields are done there is nothing
// left. The record shows it: field looks every few days through September,
// and not one pasture look after 25 August, while the rotation order ranked
// on a picture four weeks old and said so in small print.
//
// So the pastures get a run of their own, offset two hours from the field
// run so the two never share a minute. A run with nothing new is cheap; the
// point is that when there IS a new scene, it is read the same day.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const now = new Date()
  if (!shouldRunToday(now)) {
    const skip = { skipped: true, detail: 'off-season, and not the weekly Monday run' }
    console.log('Pasture satellite:', JSON.stringify(skip))
    return new Response(JSON.stringify(skip), { headers: { 'Content-Type': 'application/json' } })
  }
  const sb = admin()
  const result = await runPastureIngest(sb, {
    days: inSeason(now) ? 14 : 21,
    budgetMs: 16_000,
    imageryBudgetMs: 6_000,
  })
  console.log('Pasture satellite:', JSON.stringify(result))
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}

export const config: Config = { schedule: '0 2-22/4 * * *' }
