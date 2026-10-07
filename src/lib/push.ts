import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export const pushSupported =
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export type PushState = 'unsupported' | 'not-configured' | 'default' | 'granted' | 'denied' | 'subscribed'

export function usePushState() {
  const [state, setState] = useState<PushState>(() =>
    !pushSupported
      ? 'unsupported'
      : !VAPID_PUBLIC
        ? 'not-configured'
        : Notification.permission === 'denied'
          ? 'denied'
          : 'default',
  )

  useEffect(() => {
    if (state !== 'default') return
    let cancelled = false
    ;(async () => {
      // Where notifications are already allowed, register first and report
      // after: showing "Enable" on a phone that only needed re-saving is how
      // this looked switched off when it was not.
      if (Notification.permission === 'granted') {
        try {
          await syncPushSubscription()
        } catch {
          /* reported below as not subscribed */
        }
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (!cancelled) {
        setState(sub ? 'subscribed' : Notification.permission === 'granted' ? 'granted' : 'default')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [state])

  return { state, setState }
}

export async function subscribeToPush(): Promise<PushState> {
  if (!pushSupported) return 'unsupported'
  if (!VAPID_PUBLIC) return 'not-configured'
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return 'denied'
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
  })
  await saveSubscription(sub)
  return 'subscribed'
}

/** Put this device's subscription on file for whoever is signed in. */
async function saveSubscription(sub: PushSubscription) {
  const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } }
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? '',
    p_auth: json.keys?.auth ?? '',
  })
  if (error) throw error
}

/**
 * Keep this device's push subscription on the server, every time the app opens.
 *
 * Saving only when "Enable" was pressed meant a subscription later lost from
 * the server -- or rotated by the browser, or saved under somebody else's
 * login on a shared phone -- left the device showing notifications as on
 * while the server had nowhere to send them. Where notifications are already
 * allowed, this re-saves the subscription, or makes a new one without asking
 * again (the permission is already given).
 */
export async function syncPushSubscription(): Promise<void> {
  if (!pushSupported || !VAPID_PUBLIC) return
  if (Notification.permission !== 'granted') return
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
    })
  }
  await saveSubscription(sub)
}

/** Once per signed-in session: make sure the server can reach this device. */
export function usePushSync(userId: string | null | undefined) {
  useEffect(() => {
    if (!userId) return
    syncPushSubscription().catch((e) => console.warn('push sync failed', e))
  }, [userId])
}

/** A notification to yourself, to check the phone gets it. */
export async function sendTestNotification(): Promise<void> {
  const { error } = await supabase.rpc('send_test_notification')
  if (error) throw error
}

export async function unsubscribeFromPush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
}
