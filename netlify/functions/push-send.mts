import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'
import { hydrateSecrets } from '../shared/secrets.ts'

// Called by the notifications-insert DB trigger (via pg_net). Verifies the
// shared secret, loads the notification + the target user's push
// subscriptions, and sends a Web Push to each. Dead subscriptions (404/410)
// are pruned.

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let vapidPublic = process.env.VITE_VAPID_PUBLIC_KEY
let vapidPrivate = process.env.VAPID_PRIVATE_KEY
let vapidSubject = process.env.VAPID_SUBJECT ?? 'mailto:user-8c69@example.com'
let hookSecret = process.env.PUSH_HOOK_SECRET

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  // Re-read after the saved keys are filled in; at load time they were not there yet.
  vapidPublic = process.env.VITE_VAPID_PUBLIC_KEY
  vapidPrivate = process.env.VAPID_PRIVATE_KEY
  vapidSubject = process.env.VAPID_SUBJECT ?? 'mailto:user-8c69@example.com'
  hookSecret = process.env.PUSH_HOOK_SECRET
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  if (!url || !serviceKey || !vapidPublic || !vapidPrivate) {
    return new Response('Not configured', { status: 501 })
  }
  if (hookSecret && req.headers.get('x-push-secret') !== hookSecret) {
    return new Response('Forbidden', { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { notification_id?: string }
  if (!body.notification_id) return new Response('Missing notification_id', { status: 400 })

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: n } = await admin
    .from('notifications')
    .select('user_id, title, body, link')
    .eq('id', body.notification_id)
    .single()
  if (!n) return new Response('Notification not found', { status: 404 })

  // One retry: a burst of notifications (one per manager) arrives as a burst
  // of calls, and a failed read here used to look exactly like "no devices".
  let subs: { endpoint: string; p256dh: string; auth: string }[] | null = null
  let subsError: string | null = null
  for (let attempt = 0; attempt < 2 && subs == null; attempt++) {
    const r = await admin.from('push_subscriptions').select('*').eq('user_id', n.user_id)
    if (r.error) subsError = r.error.message
    else subs = r.data
  }
  if (subs == null) {
    console.error('push-send: could not read subscriptions', subsError)
    return new Response(JSON.stringify({ sent: 0, error: `subscriptions: ${subsError}` }), { status: 200 })
  }
  if (!subs.length) return new Response(JSON.stringify({ sent: 0, devices: 0 }), { status: 200 })

  // The unread count travels WITH the push, because the service worker that
  // receives it has no session and cannot ask the database. Counted after the
  // row that triggered this exists, so it includes the one being announced.
  const { count: unread } = await admin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', n.user_id)
    .is('read_at', null)

  const payload = JSON.stringify({
    title: n.title,
    body: n.body ?? '',
    // A tap opens the notification's own page (meaning, steps, error log),
    // which has the button through to n.link.
    link: `/notifications/${body.notification_id}`,
    unread: unread ?? 0,
  })
  let sent = 0
  const dead: string[] = []
  const failures: string[] = []
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        )
        sent++
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) dead.push(s.endpoint)
        else failures.push(`${status ?? '?'} ${String((e as { body?: string }).body ?? (e as Error).message).slice(0, 120)}`)
      }
    }),
  )
  if (dead.length) await admin.from('push_subscriptions').delete().in('endpoint', dead)

  if (failures.length) console.error('push-send: failures', failures)
  // What happened travels back to pg_net's response table, where "sent: 0"
  // alone used to say nothing about why.
  return new Response(JSON.stringify({ sent, devices: subs.length, pruned: dead.length, ...(failures.length ? { failures } : {}) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
