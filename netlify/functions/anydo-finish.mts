import { admin, finishAnydo, json, requireUser } from './_anydo.mts'

// The second half of a person's Any.do sign-in: they paste the address Any.do
// sent their browser to (a localhost page that does not load), and this
// exchanges its code for their keys. Only ever for the caller's own sign-in.
export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  const userId = await requireUser(req, sb)
  if (!userId) return json({ error: 'Sign in first' }, 401)
  const { url } = (await req.json().catch(() => ({}))) as { url?: string }
  if (!url) return json({ error: 'Paste the address from the browser' }, 400)
  try {
    await finishAnydo(sb, userId, url)
    return json({ ok: true })
  } catch (e) {
    return json({ error: (e as Error).message }, 400)
  }
}
