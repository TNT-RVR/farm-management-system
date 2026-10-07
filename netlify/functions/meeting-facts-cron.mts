import { createClient } from '@supabase/supabase-js'
import { hydrateSecrets } from '../shared/secrets.ts'

/**
 * The weekly nudge that keeps the fact library from running down.
 *
 * Wednesday rather than Monday: the top-up is for the weeks AFTER this one, and
 * running it mid-week keeps it clear of the Monday-morning news pull and of
 * anybody actually opening the meeting.
 *
 * It does not do the writing. A scheduled function is killed at about thirty
 * seconds and a web-grounded model call takes longer than that, so this fires
 * the background function and returns — which is all a scheduled function has
 * time to do honestly.
 */
export const config = { schedule: '40 9 * * 3' } // Wednesdays, 09:40 UTC

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
const site = process.env.URL

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })

  if (!workerKey || !site) {
    // Said out loud rather than returning quietly: without it the library runs
    // down silently, which is the one failure this whole thing exists to stop.
    // The heartbeat is what turns it into an alert a manager sees.
    const detail = `cannot start the fact top-up: ${!workerKey ? 'JOB_WORKER_KEY' : 'URL'} is not set`
    console.warn(`[facts] ${detail}`)
    await createClient(url, serviceKey).rpc('record_integration_heartbeat', {
      p_key: 'meeting_facts',
      p_detail: detail,
      p_data_at: null,
    })
    return new Response(detail, { status: 200 })
  }

  // Background functions answer 202 immediately and carry on. Whether there is
  // anything to write is decided in there, where the library is already loaded.
  const res = await fetch(`${site}/.netlify/functions/meeting-facts-topup-background`, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey },
  })
  const detail = `woke the fact top-up: ${res.status}`
  console.log(`[facts] ${detail}`)
  return new Response(detail, { status: 200 })
}
