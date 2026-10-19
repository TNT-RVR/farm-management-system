import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCheck, Settings } from 'lucide-react'
import { NotificationItem } from '@/components/NotificationItem'
import { PillTabs } from '@/components/PillTabs'
import { Select } from '@/components/Select'
import {
  useNotificationFeed,
  useNotifications,
  useOpenNotification,
  useSetRead,
  useUnreadCount,
} from '@/lib/notifications'
import {
  filterValueFor,
  kindGroupLabel,
  kindsForFilter,
  NOTIFICATION_SETTINGS_PATH,
} from '@/lib/notification-format'

type Show = 'all' | 'unread'

/**
 * Every notification, whole: All / Unread, by kind, a page at a time. Tapping
 * one goes where it points; the circle marks it read or unread; the (i) opens
 * its own page. Titled "Notifications" to match the home tile. `?show=unread` and
 * `?kind=<label>` pick the filters, so a link can land on them.
 */
export function NotificationsPage() {
  const [search, setSearch] = useSearchParams()
  const show: Show = search.get('show') === 'unread' ? 'unread' : 'all'
  const kind = search.get('kind') ?? ''
  const kinds = useMemo(() => (kind ? kindsForFilter(kind) : null), [kind])
  const feed = useNotificationFeed({ unread: show === 'unread', kinds })
  const { data: recent } = useNotifications()
  const { data: unreadCount } = useUnreadCount()
  const setRead = useSetRead()
  const openNotification = useOpenNotification()
  const unread = unreadCount ?? 0
  const rows = feed.data?.pages.flat() ?? []

  // The kinds this person actually gets (from the newest 100), plus whichever is chosen.
  const kindOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const n of recent ?? []) seen.set(filterValueFor(n.kind), kindGroupLabel(n.kind))
    if (kind && !seen.has(kind)) seen.set(kind, kindGroupLabel(kind))
    return [
      { value: '', label: 'All kinds' },
      ...[...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
    ]
  }, [recent, kind])

  const setParam = (key: string, value: string | null) =>
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <div className="mb-3 flex items-center gap-2">
        <h1 className="flex-1 text-lg font-semibold text-gray-900">
          Notifications{unread > 0 ? ` (${unread} unread)` : ''}
        </h1>
        <button
          type="button"
          disabled={unread === 0}
          onClick={() => setRead.mutate({ ids: 'all', read: true })}
          className="flex h-10 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          <CheckCheck className="h-4 w-4" /> Mark all read
        </button>
        <Link
          to={NOTIFICATION_SETTINGS_PATH}
          className="flex h-10 w-10 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-800"
          aria-label="Notification settings"
          title="Notification settings"
        >
          <Settings className="h-4 w-4" />
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <PillTabs<Show>
          tabs={[
            { key: 'all', label: 'All' },
            { key: 'unread', label: unread > 0 ? `Unread (${unread})` : 'Unread' },
          ]}
          value={show}
          onChange={(k) => setParam('show', k === 'unread' ? 'unread' : null)}
        />
        <Select
          value={kind}
          options={kindOptions}
          onChange={(v) => setParam('kind', v || null)}
          ariaLabel="Kind"
          className="ml-auto min-w-40"
        />
      </div>

      {feed.isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : feed.isError ? (
        <p className="text-sm text-red-600">{(feed.error as Error).message}</p>
      ) : rows.length ? (
        <>
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
            {rows.map((n) => (
              <li key={n.id}>
                <NotificationItem
                  n={n}
                  showDetails
                  onOpen={() => openNotification(n)}
                  onToggleRead={() => setRead.mutate({ ids: [n.id], read: !n.read_at })}
                />
              </li>
            ))}
          </ul>
          {feed.hasNextPage && (
            <button
              type="button"
              onClick={() => void feed.fetchNextPage()}
              disabled={feed.isFetchingNextPage}
              className="mx-auto mt-3 flex h-10 items-center rounded-md border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {feed.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      ) : (
        <p className="text-sm text-gray-400">
          {show === 'unread' || kind ? 'Nothing matches.' : 'No notifications yet.'}
        </p>
      )}
    </div>
  )
}
