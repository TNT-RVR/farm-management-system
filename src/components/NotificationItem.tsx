import { Link } from 'react-router-dom'
import { CheckCircle2, Circle, Info } from 'lucide-react'
import type { NotificationRow } from '@/lib/notifications'
import { formatWhen, kindLabel } from '@/lib/notification-format'
import { cn } from '@/lib/utils'

/**
 * One notification in a list: the unread dot, the message, "<kind> · <when>",
 * and a circle on the right that marks it read or unread without opening it.
 * `clamp` cuts the message at three lines (the bell); the Notifications page shows it whole.
 */
export function NotificationItem({
  n,
  clamp,
  onOpen,
  onToggleRead,
  showDetails,
}: {
  n: NotificationRow
  clamp?: boolean
  onOpen: () => void
  onToggleRead: () => void
  /** A link to the notification's own page (what it means, what to do). */
  showDetails?: boolean
}) {
  const read = Boolean(n.read_at)
  const created = new Date(n.created_at)
  return (
    <div className={cn('flex items-start', !read && 'bg-brand-50/60')}>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-11 min-w-0 flex-1 items-start gap-2.5 py-3 pl-3 pr-1 text-left hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none"
      >
        <span
          aria-hidden
          className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', read ? 'bg-transparent' : 'bg-brand-600')}
        />
        <span className="min-w-0 flex-1">
          {clamp ? (
            <span className={cn('line-clamp-3 text-sm break-words', read ? 'text-gray-700' : 'text-gray-900')}>
              <span className={cn(!read && 'font-semibold')}>{n.title}</span>
              {n.body ? <span className="text-gray-600"> — {n.body}</span> : null}
            </span>
          ) : (
            <>
              <span className={cn('block text-sm break-words', read ? 'text-gray-700' : 'font-semibold text-gray-900')}>
                {n.title}
              </span>
              {n.body && <span className="mt-0.5 block whitespace-pre-line text-sm break-words text-gray-600">{n.body}</span>}
            </>
          )}
          <span
            className="mt-0.5 block text-xs text-gray-400"
            title={created.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}
          >
            {kindLabel(n.kind, n.title)} · {formatWhen(created)}
          </span>
        </span>
      </button>
      {showDetails && (
        <Link
          to={`/notifications/${n.id}`}
          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="What this means"
          title="What this means"
        >
          <Info className="h-4 w-4" />
        </Link>
      )}
      <button
        type="button"
        role="checkbox"
        aria-checked={read}
        aria-label={read ? 'Mark as unread' : 'Mark as read'}
        title={read ? 'Mark as unread' : 'Mark as read'}
        onClick={(e) => {
          e.stopPropagation()
          onToggleRead()
        }}
        className="mr-1 mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-gray-100"
      >
        {read ? (
          <CheckCircle2 className="h-5 w-5 text-brand-600" />
        ) : (
          <Circle className="h-5 w-5 text-gray-300 hover:text-gray-500" />
        )}
      </button>
    </div>
  )
}
