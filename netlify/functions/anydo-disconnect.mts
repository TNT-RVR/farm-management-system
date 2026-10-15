import { admin, json, requireUser } from './_anydo.mts'

// Forget one person's Any.do link: their keys and their connection row.
// Only ever the caller's own.
export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  const userId = await requireUser(req, sb)
  if (!userId) return json({ error: 'Sign in first' }, 401)
  await sb.from('anydo_tokens').delete().eq('user_id', userId)
  await sb.from('anydo_connections').delete().eq('user_id', userId)
  return json({ ok: true })
}
