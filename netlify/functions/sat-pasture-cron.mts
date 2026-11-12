import type { Config } from '@netlify/functions'
import { admin } from './_jd.mts'
import { inSeason, shouldRunToday } from '../shared/sat-ingest.ts'
import { runPastureIngest } from '../shared/sat-run.ts'
import { liveJob } from '../shared/sat-backfill.ts'
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

  // The stalled-backfill check comes BEFORE the seasonal gate, because the gate
  // drops this to Mondays under snow and a backfill is something a person
  // started and is waiting on. A season of history is most likely to be asked
  // for in the winter, which is exactly when the gate is shut.
  await resumeBackfill()

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

/**
 * Restart a backfill that has gone quiet.
 *
 * The backfill chains itself: each run starts the next while work remains. That
 * is one fetch, and a fetch can be lost -- a cold start that times out, a
 * deploy mid-run, a Netlify hiccup -- and when it is, the job simply stops with
 * its cursor part way through and nothing says so. This is the thing that
 * notices. Twenty-five minutes is comfortably past a thirteen-minute run, so a
 * live chain is never interrupted and a dead one never waits more than the four
 * hours between these runs.
 */
async function resumeBackfill() {
  try {
    const key = process.env.JOB_WORKER_KEY
    if (!key || !process.env.URL) return
    const job = await liveJob(admin(), 'pasture')
    if (!job?.updated_at) return
    if (Date.now() - Date.parse(job.updated_at) < 25 * 60_000) return
    console.log('Pasture satellite: restarting the stalled backfill', job.id, job.phase, job.cursor_date)
    await fetch(`${process.env.URL}/.netlify/functions/sat-backfill-background?subject=pasture`, {
      method: 'POST',
      headers: { 'x-worker-key': key, 'content-type': 'application/json' },
    }).catch(() => {})
  } catch (e) {
    console.log('Pasture satellite: backfill check failed', (e as Error).message.slice(0, 120))
  }
}

export const config: Config = { schedule: '0 2-22/4 * * *' }
