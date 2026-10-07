import { admin, json, requireManager } from './_jd.mts'
import { syncOneLabel } from '../shared/chemical-labels-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Reads one product's label on demand.
//
// The app calls this the first time anyone opens a chemical that has never been
// read, so the label fills itself in while you are looking at it rather than
// waiting for the monthly pass. Also the "read the label again" button.
//
// A Netlify background function -- the `-background` filename suffix is what
// makes it one (returns 202 immediately, runs up to 15 min). Fetching a 20-56
// page PDF and having Claude read it is far past the 10s a normal function gets.

let apiKey = process.env.ANTHROPIC_API_KEY
let model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5'

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  apiKey = process.env.ANTHROPIC_API_KEY
  model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5'
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not set' }, 501)

  const sb = admin()
  // Reading a label writes to a shared table every user relies on, so it stays
  // manager-gated even though the source is public.
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can read labels' }, 403)
  }

  const body = (await req.json().catch(() => ({}))) as { registration_number?: string; force?: boolean }
  const reg = (body.registration_number ?? '').trim()
  if (!reg) return json({ error: 'registration_number required' }, 400)

  const result = await syncOneLabel(sb, reg, apiKey, model, { force: Boolean(body.force) })
  return json(result, result.ok ? 200 : 502)
}
