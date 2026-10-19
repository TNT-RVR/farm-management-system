import { admin } from './_jd.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { runNotificationDigests } from '../shared/notification-digests.ts'

// Quiet-hours summaries and daily digests. Woken every 15 minutes by
// notification-digests-cron with the worker key; nothing else may run it.
export default async (req: Request) => {
  // Keys saved on Farm setup (VAPID keys, the farm's time zone).
  await hydrateSecrets()
  const workerKey = process.env.JOB_WORKER_KEY
  if (req.method !== 'POST' || !workerKey || req.headers.get('x-worker-key') !== workerKey) {
    return new Response('Forbidden', { status: 403 })
  }
  const sb = admin()
  try {
    const r = await runNotificationDigests(sb)
    console.log('[notification-digests]', r.detail)
    return new Response(r.detail)
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300)
    console.error('[notification-digests] failed:', msg)
    const now = new Date().toISOString()
    await sb
      .from('integration_health')
      .update({ status: 'error', detail: msg, last_checked_at: now, updated_at: now })
      .eq('source_key', 'notification_digests')
    return new Response(msg, { status: 500 })
  }
}
