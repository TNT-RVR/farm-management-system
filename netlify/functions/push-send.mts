import { createClient } from '@supabase/supabase-js'
import { hydrateSecrets } from '../shared/secrets.ts'
import { deliverPush } from '../shared/push-deliver.ts'

// Called by the notifications-insert DB trigger (via pg_net). Verifies the
// shared secret, loads the notification + the target user's push
// subscriptions, and sends a Web Push to each (shared/push-deliver.ts). Dead
// subscriptions (404/410) are pruned. A push held for quiet hours or the
// daily digest never calls here: fn_push_dispatch files it in
// notification_push_queue and notification-digests-background sends it.

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let vapidPublic = process.env.VITE_VAPID_PUBLIC_KEY
let vapidPrivate = process.env.VAPID_PRIVATE_KEY
let hookSecret = process.env.PUSH_HOOK_SECRET

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  // Re-read after the saved keys are filled in; at load time they were not there yet.
  vapidPublic = process.env.VITE_VAPID_PUBLIC_KEY
  vapidPrivate = process.env.VAPID_PRIVATE_KEY
  hookSecret = process.env.PUSH_HOOK_SECRET
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  if (!url || !serviceKey || !vapidPublic || !vapidPrivate) {
    return new Response('Not configured', { status: 501 })
  }
  // No secret configured is a refusal, not an open door (security review, 15 Oct 2026).
  if (!hookSecret || req.headers.get('x-push-secret') !== hookSecret) {
    return new Response('Forbidden', { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { notification_id?: string }
  if (!body.notification_id) return new Response('Missing notification_id', { status: 400 })

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: n } = await admin
    .from('notifications')
    .select('user_id, title, body, link')
    .eq('id', body.notification_id)
    .single()
  if (!n) return new Response('Notification not found', { status: 404 })

  // A tap opens the notification's own page (meaning, steps, error log),
  // which has the button through to n.link.
  const r = await deliverPush(admin, n.user_id, { title: n.title, body: n.body ?? '', link: `/notifications/${body.notification_id}` })
  // What happened travels back to pg_net's response table, where "sent: 0"
  // alone used to say nothing about why.
  return new Response(JSON.stringify(r), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
