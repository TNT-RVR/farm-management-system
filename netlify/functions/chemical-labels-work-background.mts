import { createClient } from '@supabase/supabase-js'
import { runLabelQueue } from '../shared/chemical-labels-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

/**
 * Reading the label backlog, somewhere it has time to finish.
 *
 * This used to run inside the scheduled function, which is why long labels were
 * never read. A scheduled function is killed after about thirty seconds; a
 * label takes fifteen to forty, and a fifty-page one read in sections takes
 * minutes. So the worker claimed a label, marked it 'reading', and was killed
 * mid-call — leaving a row that looked busy and a queue that looked empty. The
 * function's own logs showed sub-second invocations doing nothing, because the
 * runs that picked up work never lived long enough to log anything at all.
 *
 * Background functions get fifteen minutes. That is the only difference that
 * matters here, and it is the difference between a label being read and a label
 * cycling forever.
 *
 * It is HTTP-reachable, so it is authorised: a shared key the cron holds, and a
 * flat refusal when that key is not configured. An open endpoint that runs the
 * model on demand is somebody else's API bill.
 */
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let apiKey = process.env.ANTHROPIC_API_KEY
let model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5'
let workerKey = process.env.JOB_WORKER_KEY ?? process.env.LABEL_WORKER_KEY

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  apiKey = process.env.ANTHROPIC_API_KEY
  model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5'
  workerKey = process.env.JOB_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  if (!apiKey) return new Response('No ANTHROPIC_API_KEY', { status: 500 })

  // Fail closed. Without the key nobody can call this, including the cron,
  // which is a visible outage rather than a quiet open door.
  if (!workerKey) return new Response('JOB_WORKER_KEY is not set', { status: 503 })
  if (req.headers.get('x-worker-key') !== workerKey)
    return new Response('Not authorised', { status: 401 })

  const sb = createClient(url, serviceKey)
  // Ten minutes, inside the fifteen a background function is given, leaving
  // room for the label in flight when the budget runs out to finish.
  const result = await runLabelQueue(sb, apiKey, model, { budgetMs: 10 * 60_000 })
  console.log('[labels] ' + result.detail)
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  })
}
