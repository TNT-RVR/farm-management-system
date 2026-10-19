import webpush from 'web-push'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * One Web Push to every device a person has: push-send (one notification)
 * and the notification-digests job (a quiet-hours summary) share it. Dead
 * subscriptions (404/410) are pruned. Call after hydrateSecrets, which fills
 * the VAPID keys saved on Farm setup.
 */
export type PushResult = { sent: number; devices: number; pruned: number; failures?: string[]; error?: string }

export function vapidReady(): boolean {
  return Boolean(process.env.VITE_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

export async function deliverPush(
  admin: SupabaseClient,
  userId: string,
  msg: { title: string; body: string; link: string },
): Promise<PushResult> {
  const pub = process.env.VITE_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return { sent: 0, devices: 0, pruned: 0, error: 'not configured' }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:user-8c69@example.com', pub, priv)

  // One retry: a burst of notifications (one per manager) arrives as a burst
  // of calls, and a failed read here used to look exactly like "no devices".
  let subs: { endpoint: string; p256dh: string; auth: string }[] | null = null
  let subsError: string | null = null
  for (let attempt = 0; attempt < 2 && subs == null; attempt++) {
    const r = await admin.from('push_subscriptions').select('*').eq('user_id', userId)
    if (r.error) subsError = r.error.message
    else subs = r.data
  }
  if (subs == null) {
    console.error('push: could not read subscriptions', subsError)
    return { sent: 0, devices: 0, pruned: 0, error: `subscriptions: ${subsError}` }
  }
  if (!subs.length) return { sent: 0, devices: 0, pruned: 0 }

  // The unread count travels WITH the push, because the service worker that
  // receives it has no session and cannot ask the database.
  const { count: unread } = await admin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)

  const payload = JSON.stringify({ title: msg.title, body: msg.body, link: msg.link, unread: unread ?? 0 })
  let sent = 0
  const dead: string[] = []
  const failures: string[] = []
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
        sent++
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) dead.push(s.endpoint)
        else failures.push(`${status ?? '?'} ${String((e as { body?: string }).body ?? (e as Error).message).slice(0, 120)}`)
      }
    }),
  )
  if (dead.length) await admin.from('push_subscriptions').delete().in('endpoint', dead)
  if (failures.length) console.error('push: failures', failures)
  return { sent, devices: subs.length, pruned: dead.length, ...(failures.length ? { failures } : {}) }
}
