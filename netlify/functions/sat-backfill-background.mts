import { admin, json, requireManager } from './_jd.mts'
import {
  BACKFILL_KINDS,
  cancelJob,
  liveJob,
  planBackfill,
  startJob,
  workBackfill,
} from '../shared/sat-backfill.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Catch the satellite record up over a past season.
//
// The nightly runs look back a fortnight, which keeps up and never catches up.
// The pasture record is the case for this: the pasture stage stalled from
// 25 August 2026 until it was given its own cron in October, so the earliest
// picture of any paddock is 4 August -- and the herd was out from 29 April.
//
// Background, not scheduled. A scheduled function gets about twenty seconds,
// which is five rasters; a background one gets fifteen minutes, which is a few
// hundred. Even that is not a season, so this is a JOB (sat_backfill_runs):
// each run works to its deadline, writes down where it got to, and starts a
// fresh run while anything is left. A run that got nowhere does not chain, so a
// dead credential cannot become an endless queue.
//
// POST, with the worker key or a manager's session:
//   ?plan=1&from=2026-04-15&to=2026-11-01   count the work, spend NOTHING
//   ?from=2026-04-15&to=2026-11-01          start (or resume) the job
//   (no dates)                              resume the running job
//   ?cancel=1                               stop the running job
//   &subject=field                          the fields instead of the pastures
//
// `plan` is the one to run first, always. It asks the catalog, which costs no
// processing units, and reports exactly how many passes are in the range and
// exactly how many pictures are missing against the looks already on file --
// so the bill is known before any of it is bought. The free Copernicus tier is
// 30,000 units a month, this farm already spends about 9,000, and a true-colour
// raster is 4 of them.
//
// Neither mode answers in its response, and cannot: a Netlify background
// function sends 202 with an empty body before the handler starts. So the plan
// lands in sat_backfill_plans and the work in sat_backfill_runs, and those are
// where to read what happened.

let workerKey = process.env.JOB_WORKER_KEY

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  const byKey = !!workerKey && req.headers.get('x-worker-key') === workerKey
  let who: string | null = null
  if (!byKey) {
    who = await requireManager(req, sb)
    if (!who) return json({ error: 'Only active managers can run the satellite backfill' }, 403)
  }

  const url = new URL(req.url)
  const subjectType = url.searchParams.get('subject') === 'field' ? 'field' : 'pasture'
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const day = /^\d{4}-\d{2}-\d{2}$/

  if (url.searchParams.get('cancel') === '1') {
    const stopped = await cancelJob(sb, subjectType)
    return json({ cancelled: stopped })
  }

  // Counting only. No statistics, no rasters, no units.
  //
  // The answer goes into sat_backfill_plans rather than into the response,
  // because this is a BACKGROUND function: Netlify sends 202 with an empty body
  // before the handler runs, so there is no response for a caller to read. Both
  // the plan and the work need that, which is why neither returns anything
  // worth having and both write down what they did.
  if (url.searchParams.get('plan') === '1') {
    if (!from || !to || !day.test(from) || !day.test(to) || from > to) {
      return json({ error: 'plan needs from=YYYY-MM-DD and to=YYYY-MM-DD, from on or before to' }, 400)
    }
    try {
      const plan = await planBackfill(sb, { from, to, subjectType, kinds: BACKFILL_KINDS })
      await sb
        .from('sat_backfill_plans')
        .insert({ subject_type: subjectType, from_date: from, to_date: to, plan, created_by: who })
      console.log('[sat-backfill] plan', JSON.stringify(plan))
      return json(plan)
    } catch (e) {
      const detail = (e as Error).message.slice(0, 300)
      // A failed plan is written down too. Otherwise the only trace of a dead
      // credential or a Copernicus outage is a 202 and silence, which reads
      // exactly like a range with nothing in it.
      await sb
        .from('sat_backfill_plans')
        .insert({
          subject_type: subjectType,
          from_date: from,
          to_date: to,
          plan: { error: detail },
          created_by: who,
        })
        .then(() => undefined, () => undefined)
      return json({ error: detail }, 502)
    }
  }

  if (from || to) {
    if (!from || !to || !day.test(from) || !day.test(to) || from > to) {
      return json({ error: 'from=YYYY-MM-DD and to=YYYY-MM-DD, from on or before to' }, 400)
    }
    try {
      await startJob(sb, { from, to, subjectType, createdBy: who })
    } catch (e) {
      // Almost always "a job over another range is already running", which is a
      // conflict to report, not a failure to retry.
      return json({ error: (e as Error).message.slice(0, 300) }, 409)
    }
  } else if (!(await liveJob(sb, subjectType))) {
    return json({ error: 'No backfill is running. Pass from= and to= to start one.' }, 400)
  }

  // Thirteen minutes of a background function's fifteen, so the update to
  // sat_backfill_runs and the chaining fetch are never the thing that is cut
  // off -- a job whose cursor was not written would re-buy the window.
  const progress = await workBackfill(sb, { subjectType, deadline: Date.now() + 13 * 60_000 })
  console.log('[sat-backfill]', JSON.stringify(progress))

  if (progress?.more && workerKey && process.env.URL) {
    await fetch(
      `${process.env.URL}/.netlify/functions/sat-backfill-background?subject=${subjectType}`,
      {
        method: 'POST',
        headers: { 'x-worker-key': workerKey, 'content-type': 'application/json' },
      },
    ).catch(() => {})
  }

  return json(progress ?? { error: 'no job' }, progress ? 200 : 400)
}
