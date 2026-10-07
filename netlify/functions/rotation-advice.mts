import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

/**
 * Rotation → recommendations: takes the request and hands it to the
 * background job.
 *
 * The comparison itself runs in rotation-advice-background, because the
 * advisor model needs about a minute and a half and a normal function is cut
 * off long before that (the gateway returns an HTML timeout page). This checks
 * who is asking, records the request in rotation_advice, wakes the job with the
 * worker key and answers straight away with the row's id; the page polls the
 * row until the advice is written.
 */
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let apiKey = process.env.ANTHROPIC_API_KEY
let workerKey = process.env.JOB_WORKER_KEY
const site = process.env.URL

export const config = { path: '/api/rotation-advice' }

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  apiKey = process.env.ANTHROPIC_API_KEY
  workerKey = process.env.JOB_WORKER_KEY
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!url || !serviceKey) return json({ error: 'Not configured' }, 500)
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set' }, 501)
  if (!workerKey || !site) return json({ error: `${!workerKey ? 'JOB_WORKER_KEY' : 'URL'} is not set` }, 501)

  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: au } = bearer ? await getUserMfa(sb, bearer) : { data: { user: null } }
  const { data: prof } = au.user ? await sb.from('users').select('active').eq('id', au.user.id).single() : { data: null }
  if (!prof?.active) return json({ error: 'Not authorised' }, 401)

  // Kept as the exact text sent: the page hashes the same string to tell
  // whether the plans have changed since the advice was written.
  const text = await req.text()
  if (text.length > 120_000) return json({ error: 'Too much to send' }, 413)
  let year: number
  try {
    year = Number((JSON.parse(text) as { year?: unknown }).year)
  } catch {
    return json({ error: 'Send JSON' }, 400)
  }
  if (!Number.isInteger(year)) return json({ error: 'year required' }, 400)

  // The same plans already being written: hand back that request rather than
  // pay for a second one (a double tap, a reload, two people at once).
  const hash = createHash('sha256').update(text).digest('hex')
  const { data: inFlight } = await sb
    .from('rotation_advice')
    .select('id')
    .eq('crop_year', year)
    .eq('request_hash', hash)
    .eq('status', 'pending')
    .gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString())
    .limit(1)
  if (inFlight?.length) return json({ id: inFlight[0].id }, 202)

  const { data: row, error } = await sb
    .from('rotation_advice')
    .insert({ crop_year: year, requested_by: au.user!.id, request: text, request_hash: hash })
    .select('id')
    .single()
  if (error || !row) return json({ error: `Could not record the request: ${error?.message ?? 'no row'}` }, 500)

  // A background function answers 202 as soon as it is accepted.
  const woke = await fetch(`${site}/.netlify/functions/rotation-advice-background`, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey, 'content-type': 'application/json' },
    body: JSON.stringify({ id: row.id }),
  }).catch((e: Error) => ({ ok: false, status: 0, statusText: e.message }))
  if (!woke.ok) {
    const why = `Could not start the advice job (${woke.status || woke.statusText})`
    await sb.from('rotation_advice').update({ status: 'error', error: why, finished_at: new Date().toISOString() }).eq('id', row.id)
    return json({ error: why }, 502)
  }
  return json({ id: row.id }, 202)
}
