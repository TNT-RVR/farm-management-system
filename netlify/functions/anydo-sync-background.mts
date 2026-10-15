import { admin, json, requireUser } from './_anydo.mts'
import { runAnydoSync, syncOnePerson } from '../shared/anydo-sync.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Any.do sync. Woken every 10 minutes by anydo-sync-cron with the worker key
// (everyone connected), or by a person's own "Sync now" (just them).
export default async (req: Request) => {
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  const workerKey = process.env.JOB_WORKER_KEY
  if (workerKey && req.headers.get('x-worker-key') === workerKey) {
    const results = await runAnydoSync(sb, Date.now() + 12 * 60_000)
    console.log('[anydo-sync]', JSON.stringify(results))
    return json({ ok: true, results })
  }
  const userId = await requireUser(req, sb)
  if (!userId) return json({ error: 'Sign in first' }, 401)
  const { data: conn } = await sb.from('anydo_connections').select('user_id, list_id, list_name, marker').eq('user_id', userId).eq('status', 'connected').maybeSingle()
  if (!conn) return json({ error: 'Any.do is not connected' }, 400)
  try {
    const r = await syncOnePerson(sb, conn as { user_id: string; list_id: string | null; list_name: string | null; marker: string })
    if (r.error === 'already syncing') return json({ error: 'A sync is already running — try again in a minute' }, 409)
    await sb.from('anydo_connections').update({ last_sync_at: new Date().toISOString(), last_error: null }).eq('user_id', userId)
    console.log('[anydo-sync] one', JSON.stringify(r))
    return json({ ok: true, result: r })
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300)
    await sb.from('anydo_connections').update({ last_error: msg }).eq('user_id', userId)
    return json({ error: msg }, 502)
  }
}
