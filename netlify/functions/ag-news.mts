import { createClient } from '@supabase/supabase-js'
import { runAgNewsPull } from '../shared/ag-news-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

// The same pull, on demand — for the Refresh button and for testing, because a
// weekly schedule is a slow way to find out whether a feed has started
// refusing us. No `schedule` export here: one makes a function unreachable
// over HTTP.

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return new Response('Unauthorized', { status: 401 })

  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
  // The caller's own token decides whether they may do this at all.
  const { data: who } = await getUserMfa(sb, auth.slice('Bearer '.length))
  if (!who?.user) return new Response('Unauthorized', { status: 401 })

  try {
    const r = await runAgNewsPull(sb)
    return new Response(JSON.stringify({ ok: true, ...r }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
