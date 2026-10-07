import { useEffect } from 'react'
import { useNotifications } from './notifications'

/**
 * The unread count on the installed app's icon.
 *
 * Push already worked here — a notification arrives, a banner shows. What was
 * missing is the quieter half: the number on the icon that says there is
 * something waiting without anybody opening anything. With 166 unread and no
 * badge, the icon looked exactly like an app with nothing to say.
 *
 * Nothing to detect and nothing to configure. In an ordinary browser tab
 * `setAppBadge` is simply absent and this does nothing; on an installed app —
 * Android, desktop Chrome, and iOS 16.4+ added to the Home Screen — the OS
 * paints the count and keeps it after the app closes.
 *
 * Keeping it CURRENT while closed is a different job, done by the service
 * worker when a push wakes it. See sw.ts.
 */
export function useAppBadge(): void {
  const { data: notifications } = useNotifications()
  const unread = (notifications ?? []).filter((n) => !n.read_at).length

  useEffect(() => {
    if (!('setAppBadge' in navigator)) return
    const nav = navigator as Navigator & {
      setAppBadge: (n?: number) => Promise<void>
      clearAppBadge: () => Promise<void>
    }
    // Rejections are ignored on purpose: a browser that exposes the API but
    // refuses the call (an uninstalled PWA on some platforms) is not an error
    // worth surfacing to somebody looking at a farm map.
    if (unread > 0) void nav.setAppBadge(unread).catch(() => {})
    else void nav.clearAppBadge().catch(() => {})
  }, [unread])
}
