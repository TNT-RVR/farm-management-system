import { createClient } from '@supabase/supabase-js'
import { MANAGER_ROLES } from './_jd.mts'
import { runEventsPull } from '../shared/events-pull'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

// On-demand "Look for events" — a Netlify background function (returns 202
// immediately, runs up to 15 min) so the long Claude+web-search call finishes.
// The weekly run is the scheduled events-pull.mts. Needs ANTHROPIC_API_KEY.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let apiKey = process.env.ANTHROPIC_API_KEY
let model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  apiKey = process.env.ANTHROPIC_API_KEY
  model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'
  if (!url || !serviceKey || !apiKey) return new Response('Not configured', { status: 501 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Splitting the scheduled function from this one opens an HTTP route, so this
  // half checks the caller itself: an active manager, or nothing.
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: au } = jwt ? await getUserMfa(sb, jwt) : { data: { user: null } }
  const { data: prof } = au.user
    ? await sb.from('users').select('role, active').eq('id', au.user.id).single()
    : { data: null }
  if (!prof || !MANAGER_ROLES.includes(prof.role) || !prof.active)
    return new Response('Managers only', { status: 403 })

  try {
    const r = await runEventsPull(sb, apiKey, model)
    return new Response(JSON.stringify({ ok: true, ...r }), { status: 200 })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 })
  }
}
