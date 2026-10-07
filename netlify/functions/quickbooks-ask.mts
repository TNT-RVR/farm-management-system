import { admin, json, requireFinance } from './_quickbooks.mts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Ask QuickBooks: takes a question about the books and hands it to the
// background job, which looks the answer up in several steps (vendors,
// accounts, bill lines, the invoice PDFs, QuickBooks' own reports) and writes
// it into qb_questions. That takes longer than a page request is allowed, so
// this answers straight away with the row's id and the page polls the row.
//
// Owners and the farm's accountant only (requireFinance = can_see_finances).
//
// POST { question }  →  { id }

export default async (req: Request) => {
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  const userId = await requireFinance(req, sb)
  if (!userId) return json({ error: 'Only the owners and the farm’s accountant can ask about the books' }, 403)
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'The AI key is not set (Settings → Farm setup → Keys)' }, 501)
  const workerKey = process.env.JOB_WORKER_KEY
  const site = process.env.URL
  if (!workerKey || !site) return json({ error: `${!workerKey ? 'JOB_WORKER_KEY' : 'URL'} is not set` }, 501)

  const body = ((await req.json().catch(() => null)) ?? {}) as { question?: string }
  const question = (body.question ?? '').trim()
  if (!question) return json({ error: 'Ask a question' }, 400)
  if (question.length > 2000) return json({ error: 'Keep the question under 2,000 characters' }, 413)

  const { data: acct } = await sb.from('integration_accounts').select('status, external_org_id').eq('provider', 'quickbooks').single()
  if (acct?.status !== 'connected' || !acct.external_org_id) {
    return json({ error: 'QuickBooks is not connected. Connect it under Settings → Integrations first.' }, 409)
  }

  // A question whose job was cut off (a background job gets 15 minutes) never
  // writes its answer: mark it stopped so it reads as stopped, not "working".
  await sb
    .from('qb_questions')
    .update({ status: 'error', error: 'It stopped before it finished; ask again', progress: null, finished_at: new Date().toISOString() })
    .eq('status', 'pending')
    .lt('created_at', new Date(Date.now() - 16 * 60_000).toISOString())

  // The same question just asked by the same person and still being worked
  // on: hand back that one rather than pay twice (a double tap, a reload).
  const { data: inFlight } = await sb
    .from('qb_questions')
    .select('id')
    .eq('asked_by', userId)
    .eq('question', question)
    .eq('status', 'pending')
    .gte('created_at', new Date(Date.now() - 15 * 60_000).toISOString())
    .limit(1)
  if (inFlight?.length) return json({ id: inFlight[0].id }, 202)

  const { data: row, error } = await sb
    .from('qb_questions')
    .insert({ asked_by: userId, question, progress: 'Starting…' })
    .select('id')
    .single()
  if (error || !row) return json({ error: `Could not record the question: ${error?.message ?? 'no row'}` }, 500)

  const woke = await fetch(`${site}/.netlify/functions/quickbooks-ask-background`, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey, 'content-type': 'application/json' },
    body: JSON.stringify({ id: row.id }),
  }).catch((e: Error) => ({ ok: false, status: 0, statusText: e.message }))
  if (!woke.ok) {
    await sb
      .from('qb_questions')
      .update({ status: 'error', error: `The job did not start (${woke.status} ${woke.statusText})`, finished_at: new Date().toISOString() })
      .eq('id', row.id)
    return json({ error: 'The question could not be started; try again' }, 502)
  }
  return json({ id: row.id }, 202)
}
