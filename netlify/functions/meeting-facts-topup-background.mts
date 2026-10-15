import { createClient } from '@supabase/supabase-js'
import { reportHealth, runFactTopUp } from '../shared/meeting-facts-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

/**
 * Writing more meeting facts, somewhere it has time to finish.
 *
 * A background function because the run is a web-grounded model call per month
 * and a scheduled function is killed at about thirty seconds. Background ones
 * get fifteen minutes, and nothing is waiting on the answer: the whole point is
 * that the library is topped up weeks before anybody needs it.
 *
 * Two callers, because one of them failing must not be the end of it. The
 * weekly cron is the normal path; the meeting page itself calls this when it
 * notices the month running thin, which is the backstop for a cron that has
 * stopped running. Both are answered with 202 and neither waits.
 */
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let apiKey = process.env.ANTHROPIC_API_KEY
let model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'
// The key the crons already hold. Named for the label worker because that is
// what first needed one; a FACT_WORKER_KEY overrides it if these are ever
// separated.
let workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  apiKey = process.env.ANTHROPIC_API_KEY
  model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'
  workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })

  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Either the cron's shared key, or a real signed-in person on the farm. An
  // open endpoint that runs the model on demand is somebody else's API bill.
  //
  // Checked before anything is written anywhere, including the health row: a
  // stranger must not be able to raise an alert on this farm's integrations
  // page by posting at it.
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const byWorker = Boolean(workerKey) && req.headers.get('x-worker-key') === workerKey
  let byUser = false
  if (!byWorker && bearer) {
    const { data: au } = await getUserMfa(sb, bearer)
    if (au.user) {
      const { data: prof } = await sb.from('users').select('active').eq('id', au.user.id).single()
      byUser = Boolean(prof?.active)
    }
  }
  if (!byWorker && !byUser) return new Response('Not authorised', { status: 401 })

  if (!apiKey) {
    // Said out loud. A missing key means the library stops filling and empties
    // on schedule months later, which is precisely the failure all of this
    // exists to avoid — so it becomes an alert now, not a surprise then.
    await reportHealth(sb, false, 'ANTHROPIC_API_KEY is not set, so no facts can be written')
    return new Response('No ANTHROPIC_API_KEY', { status: 501 })
  }

  // ?month=10&count=2 writes for that month whether or not it is short. Not
  // used by either caller — it is how the thing gets proved without waiting for
  // a month to actually run down.
  const q = new URL(req.url).searchParams
  const month = Number(q.get('month'))
  const only =
    Number.isInteger(month) && month >= 1 && month <= 12
      ? { month, count: Math.max(1, Number(q.get('count')) || 2) }
      : undefined

  try {
    const r = await runFactTopUp(sb, apiKey, model, new Date(), only)
    console.log('[facts] top-up:', JSON.stringify(r))
    return new Response(JSON.stringify({ ok: true, ...r }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    console.error('[facts] top-up failed:', (e as Error).message)
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 })
  }
}
