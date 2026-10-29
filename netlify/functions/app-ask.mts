import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'
import { admin } from '../shared/supabase-admin.ts'
import { isStaff } from '../shared/staff.ts'

/**
 * Ask the app: the phone search bar's Ask (Sam, 29 Oct 2026: it "can also
 * handle asking the app any type of question you want"). Records the question
 * and wakes app-ask-background, which looks the answer up in several steps;
 * that takes longer than a page request may, so this answers at once with the
 * row's id and the phone polls the row.
 *
 * The look-ups run with the asker's own login (their token goes to the job in
 * the wake-up, never into the table), so the answer can only use what that
 * person could open themselves.
 *
 * POST { question, page?, cropYear?, places: [{label, sub, to}] }  →  { id }
 * `places` is the pages, tabs and reports this person may open, from the
 * phone's own search index, so links in the answer go where they are allowed.
 */

export const config = { path: '/api/app-ask' }

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })

export type Place = { label: string; sub?: string; to: string }

export default async (req: Request) => {
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'The AI key is not set (Settings → Farm setup → Connections)' }, 501)
  const workerKey = process.env.JOB_WORKER_KEY
  const site = process.env.URL
  if (!workerKey || !site) return json({ error: `${!workerKey ? 'JOB_WORKER_KEY' : 'URL'} is not set` }, 501)
  // The public key the browser signs in with; the look-ups go through it with the asker's token.
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? req.headers.get('apikey') ?? ''
  if (!anonKey) return json({ error: 'The app key did not come with the question; reload and ask again' }, 400)

  const sb = admin()
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: au } = token ? await getUserMfa(sb, token) : { data: { user: null } }
  const { data: prof } = au.user ? await sb.from('users').select('active, role').eq('id', au.user.id).single() : { data: null }
  if (!au.user || !isStaff(prof)) return json({ error: 'Not authorised' }, 401)

  const body = ((await req.json().catch(() => null)) ?? {}) as { question?: string; page?: string; cropYear?: number; places?: Place[] }
  const question = (body.question ?? '').trim()
  if (!question) return json({ error: 'Ask a question' }, 400)
  if (question.length > 2000) return json({ error: 'Keep the question under 2,000 characters' }, 413)
  const places = (Array.isArray(body.places) ? body.places : [])
    .filter((p) => p && typeof p.label === 'string' && typeof p.to === 'string' && p.to.startsWith('/'))
    .slice(0, 1500)
    .map((p) => ({ label: p.label.slice(0, 120), sub: typeof p.sub === 'string' ? p.sub.slice(0, 160) : undefined, to: p.to.slice(0, 200) }))
  const page = typeof body.page === 'string' && body.page.startsWith('/') ? body.page.slice(0, 300) : null

  // A question whose job was cut off never writes its answer: mark it stopped.
  await sb
    .from('app_questions')
    .update({ status: 'error', error: 'It stopped before it finished; ask again', progress: null, finished_at: new Date().toISOString() })
    .eq('status', 'pending')
    .lt('created_at', new Date(Date.now() - 16 * 60_000).toISOString())

  // A double tap: hand back the one already being worked on.
  const { data: inFlight } = await sb
    .from('app_questions')
    .select('id')
    .eq('asked_by', au.user.id)
    .eq('question', question)
    .eq('status', 'pending')
    .gte('created_at', new Date(Date.now() - 5 * 60_000).toISOString())
    .limit(1)
  if (inFlight?.length) return json({ id: inFlight[0].id }, 202)

  const { data: row, error } = await sb
    .from('app_questions')
    .insert({ asked_by: au.user.id, question, page, progress: 'Starting…' })
    .select('id')
    .single()
  if (error || !row) return json({ error: `Could not record the question: ${error?.message ?? 'no row'}` }, 500)

  const woke = await fetch(`${site}/.netlify/functions/app-ask-background`, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey, 'content-type': 'application/json' },
    body: JSON.stringify({ id: row.id, token, anonKey, places, cropYear: Number(body.cropYear) || null }),
  }).catch((e: Error) => ({ ok: false, status: 0, statusText: e.message }))
  if (!woke.ok) {
    await sb
      .from('app_questions')
      .update({ status: 'error', error: `The job did not start (${woke.status} ${woke.statusText})`, finished_at: new Date().toISOString() })
      .eq('id', row.id)
    return json({ error: 'The question could not be started; try again' }, 502)
  }
  return json({ id: row.id }, 202)
}
