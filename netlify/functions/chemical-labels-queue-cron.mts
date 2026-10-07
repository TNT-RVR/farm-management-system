import { createClient } from '@supabase/supabase-js'
import { hydrateSecrets } from '../shared/secrets.ts'

// Sets the label backlog going. Does not work through it.
//
// It used to do the reading itself, and that was the bug behind every long
// label on this farm never being read. A scheduled function is killed after
// about thirty seconds. A label takes fifteen to forty, and a fifty-page one
// read in sections takes minutes — so the run claimed a label, marked it
// 'reading', and died mid-call. The row sat looking busy, the stale sweep put
// it back half an hour later, and the whole thing went round again. The logs
// showed only sub-second invocations, because the runs that picked up work
// never lived long enough to log anything.
//
// The reading now happens in chemical-labels-work-background, which gets
// fifteen minutes. This fires it and returns, which is all a scheduled function
// has time to do honestly.
// Backed off 18 Sep 2026: the Netlify plan ran out of credits and the site
// served 503 to the whole farm. These three were the bulk of the scheduled
// invocations, and none of them needs to be this eager.
export const config = { schedule: '*/30 * * * *' }

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let workerKey = process.env.JOB_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
const site = process.env.URL

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })

  // Nothing queued, nothing to wake. Checked here so the common case costs one
  // cheap query rather than a function invocation.
  const sb = createClient(url, serviceKey)
  const { count } = await sb
    .from('chemical_labels')
    .select('registration_number', { count: 'exact', head: true })
    .in('extraction_status', ['queued', 'reading'])
  if (!count) return new Response('nothing queued', { status: 200 })

  if (!workerKey || !site) {
    const detail = `${count} label(s) waiting but ${!workerKey ? 'JOB_WORKER_KEY' : 'URL'} is not set`
    console.warn(`[labels] ${detail}`)
    await sb.rpc('record_integration_heartbeat', {
      p_key: 'chemical_labels',
      p_detail: detail,
      p_data_at: null,
    })
    return new Response(detail, { status: 200 })
  }

  // Background functions answer 202 immediately and carry on, so this returns
  // long before the reading finishes — which is the point.
  const res = await fetch(`${site}/.netlify/functions/chemical-labels-work-background`, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey },
  })
  const detail = `woke the label worker for ${count} label(s): ${res.status}`
  console.log(`[labels] ${detail}`)
  return new Response(detail, { status: 200 })
}
