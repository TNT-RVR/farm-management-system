import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, Maximize2, Settings, X } from 'lucide-react'
import { NotificationItem } from '@/components/NotificationItem'
import {
  useNotifications,
  useNotificationsRealtime,
  useOpenNotification,
  useSetRead,
  useUnreadCount,
} from '@/lib/notifications'
import { NOTIFICATION_SETTINGS_PATH } from '@/lib/notification-format'
import { cn } from '@/lib/utils'

/** How many of the newest the dropdown lists; the rest are on the Notifications page. */
const SHOWN = 25

/**
 * The header bell: an unread count, and a dropdown of the newest notifications.
 * Each one opens where it points; the circle marks it read without opening it.
 * On a phone the dropdown is a full-width sheet under the header.
 */
export function NotificationBell() {
  useNotificationsRealtime()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { data: unreadCount } = useUnreadCount()
  const { data: notifications, isLoading } = useNotifications()
  const setRead = useSetRead()
  const openNotification = useOpenNotification()
  const unread = unreadCount ?? 0
  const items = (notifications ?? []).slice(0, SHOWN)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }

  const iconButton = 'flex h-10 w-10 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800'

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn('relative rounded-md p-2 text-gray-500 hover:bg-gray-100', open && 'bg-gray-100')}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-x-0 bottom-0 top-14 z-40 bg-black/30 md:hidden" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Notifications"
            className={cn(
              'z-50 flex flex-col bg-white',
              'fixed inset-x-0 bottom-0 top-14 border-t border-gray-200 shadow-2xl',
              'md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:top-full md:mt-1 md:max-h-[min(34rem,calc(100vh-5rem))] md:w-96 md:rounded-lg md:border md:shadow-lg',
            )}
          >
            <div className="flex shrink-0 items-center gap-1 border-b border-gray-100 py-1 pl-4 pr-1">
              <h2 className="flex-1 text-sm font-semibold text-gray-900">Notifications</h2>
              <button type="button" onClick={() => go('/notifications')} className={iconButton} aria-label="Open all notifications" title="Open all notifications">
                <Maximize2 className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => go(NOTIFICATION_SETTINGS_PATH)} className={iconButton} aria-label="Notification settings" title="Notification settings">
                <Settings className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setOpen(false)} className={iconButton} aria-label="Close" title="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {isLoading ? (
                <p className="px-4 py-6 text-sm text-gray-400">Loading…</p>
              ) : items.length ? (
                <ul className="divide-y divide-gray-100">
                  {items.map((n) => (
                    <li key={n.id}>
                      <NotificationItem
                        n={n}
                        clamp
                        onOpen={() => {
                          setOpen(false)
                          openNotification(n)
                        }}
                        onToggleRead={() => setRead.mutate({ ids: [n.id], read: !n.read_at })}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-6 text-sm text-gray-400">No notifications yet.</p>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between border-t border-gray-100 px-2 pb-[env(safe-area-inset-bottom)]">
              <button
                type="button"
                disabled={unread === 0}
                onClick={() => setRead.mutate({ ids: 'all', read: true })}
                className="flex h-10 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <CheckCheck className="h-4 w-4" /> Mark all read
              </button>
              <button
                type="button"
                onClick={() => go('/notifications')}
                className="flex h-10 items-center rounded-md px-2 text-xs font-medium text-brand-700 hover:bg-gray-100"
              >
                See all
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
