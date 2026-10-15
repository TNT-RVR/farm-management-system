import { createClient } from '@supabase/supabase-js'
import { hydrateSecrets } from '../shared/secrets.ts'

// Keeps the assessments written ahead of anyone opening the page: a new soil
// report gets its write-up without being asked, and a crop-plan change rewrites
// only the fields it actually affects.
//
// Wakes the sweep; does not run it. The sweep used to run right here, inside a
// scheduled function, which Netlify kills after about thirty seconds — and a
// write-up takes about a minute. So it could only ever succeed with nothing to
// do. The writing now happens in soil-assessment-sweep-background, which gets
// fifteen minutes; this checks there is work and wakes it with the worker key.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let workerKey = process.env.JOB_WORKER_KEY
const site = process.env.URL

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { count, error } = await sb
    .from('soil_reports_needing_assessment')
    .select('report_id', { count: 'exact', head: true })
  if (error) return new Response(`queue read failed: ${error.message}`, { status: 500 })

  // Nothing to write is a healthy run, and says so — see the heartbeat note in
  // soil-assessment-sweep.ts on why the idle path must report in.
  if (!count) {
    await sb.rpc('record_integration_heartbeat', { p_key: 'soil_assessments', p_detail: 'nothing to write', p_data_at: null })
    return new Response('nothing to write', { status: 200 })
  }

  if (!workerKey || !site) {
    const detail = `${count} write-up(s) waiting but ${!workerKey ? 'JOB_WORKER_KEY' : 'URL'} is not set`
    console.warn(detail)
    return new Response(detail, { status: 200 })
  }
  const res = await fetch(`${site}/.netlify/functions/soil-assessment-sweep-background`, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey },
  })
  const detail = `woke the soil sweep for ${count} write-up(s): ${res.status}`
  console.log(detail)
  return new Response(detail, { status: 200 })
}

export const config = { schedule: '25 * * * *' } // hourly at :25
