import type { Config } from '@netlify/functions'
import { admin } from './_jd.mts'
import { inSeason, shouldRunToday } from '../shared/sat-ingest.ts'
import { runFullIngest } from '../shared/sat-run.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Sentinel-2 over every field, through the growing season.
//
// Every four hours, not daily. The old reasoning — that a five-day revisit
// makes more frequent polling pointless — was right about the NUMBERS and wrong
// about the PICTURES. A scheduled function gets about thirty seconds, imagery
// runs last on what is left of that, and one run photographs a field or two. At
// one run a day that is a twenty-three day lap of the farm, which is exactly
// what was measured: pictures three days old at the head of the list and
// twenty-three at the tail.
//
// A run with no new scene is cheap by construction — the catalog is asked
// before anything is computed — so the extra runs cost almost nothing on the
// days there is nothing new, and on the days there is, the farm keeps up.
//
// Seasonal still: shouldRunToday drops it to Mondays under snow.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const now = new Date()
  if (!shouldRunToday(now)) {
    const skip = { skipped: true, detail: 'off-season, and not the weekly Monday run' }
    console.log('Satellite ingest:', JSON.stringify(skip))
    return new Response(JSON.stringify(skip), { headers: { 'Content-Type': 'application/json' } })
  }
  const sb = admin()
  // A longer window off-season, since the run is weekly rather than daily.
  // Every satellite-enabled field. The three-field cap was there until phase 1
  // proved itself, and it has.
  // A scheduled function's budget is tighter and less clearly documented than
  // a background one's, so the cron takes a deliberately conservative slice
  // and defers the rest to tomorrow. After the first full pass there is very
  // little to do on any given day — only genuinely new scenes.
  const result = await runFullIngest(sb, { days: inSeason(now) ? 14 : 21, budgetMs: 20_000, imageryBudgetMs: 10_000 })
  console.log('Satellite ingest:', JSON.stringify(result))
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}

// Fires every four hours year-round; shouldRunToday decides. Cron cannot
// express a date RANGE across months — a day-of-month list applies to every
// month named, so the previous '0 8 15-30 4 *' meant "April only" and would
// have gone dark from May to October without anyone noticing until the season
// was over.
export const config: Config = { schedule: '0 */4 * * *' }
