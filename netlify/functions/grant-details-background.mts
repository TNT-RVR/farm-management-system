import { lookUpGrantDetails } from '../shared/grant-details.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'
import { admin } from '../shared/supabase-admin.ts'
import { SONNET_5 } from '../shared/anthropic.ts'

// "Find details" on a grant: reads the program's pages and fills the blanks
// (shared/grant-details.ts). A background function — it answers 202 at once —
// because a web-searching Claude call runs well past a normal function's limit.
// Body: { id }. Any active staff member; not a crop-share partner.
export default async (req: Request) => {
  await hydrateSecrets()
  const apiKey = process.env.ANTHROPIC_API_KEY
  const model = process.env.ANTHROPIC_MODEL ?? SONNET_5
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !apiKey) return new Response('Not configured', { status: 501 })
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  const sb = admin()

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: au } = jwt ? await getUserMfa(sb, jwt) : { data: { user: null } }
  const { data: prof } = au.user ? await sb.from('users').select('role, active').eq('id', au.user.id).single() : { data: null }
  if (!prof?.active || prof.role === 'partner') return new Response('Not allowed', { status: 403 })

  const { id } = (await req.json().catch(() => ({}))) as { id?: string }
  if (!id) return new Response('id needed', { status: 400 })
  try {
    const r = await lookUpGrantDetails(sb, apiKey, model, id)
    return new Response(JSON.stringify({ ok: true, ...r }), { status: 200 })
  } catch (e) {
    // Marked checked even on failure, so the page stops offering a lookup
    // that just failed and shows when it was tried.
    await sb.from('grants').update({ details_checked_at: new Date().toISOString() }).eq('id', id)
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 })
  }
}
