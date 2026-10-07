import { useNavigate } from 'react-router-dom'
import { CheckCheck } from 'lucide-react'
import { useMarkRead, useNotifications } from '@/lib/notifications'
import { cn } from '@/lib/utils'

export function NotificationsPage() {
  const navigate = useNavigate()
  const { data: notifications, isLoading } = useNotifications()
  const markRead = useMarkRead()
  const unread = notifications?.filter((n) => !n.read_at) ?? []

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">
          Alerts{unread.length > 0 ? ` (${unread.length} unread)` : ''}
        </h1>
        {unread.length > 0 && (
          <button
            onClick={() => markRead.mutate(unread.map((n) => n.id))}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : notifications?.length ? (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {notifications.map((n) => (
            <li key={n.id}>
              <button
                // Every notification opens on its own page: what it means, what
                // to do, and (for admins) an error log — with a button through to
                // its screen. Titled "Alerts" to match the home tile.
                onClick={() => {
                  if (!n.read_at) markRead.mutate([n.id])
                  navigate(`/notifications/${n.id}`)
                }}
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-gray-50',
                  !n.read_at && 'bg-brand-50',
                )}
              >
                <span className={cn('text-sm', !n.read_at ? 'font-semibold text-gray-900' : 'text-gray-700')}>
                  {n.title}
                </span>
                {n.body && <span className="text-xs text-gray-500">{n.body}</span>}
                <span className="text-xs text-gray-400">
                  {new Date(n.created_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-400">Nothing yet — task assignments, completions, and reminders show up here.</p>
      )}
    </div>
  )
}
