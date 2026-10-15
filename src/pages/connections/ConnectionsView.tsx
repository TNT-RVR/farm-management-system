import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { ChevronRight, Search, X } from 'lucide-react'
import { Select } from '@/components/Select'
import { hasAdminAccess, hasManagerAccess, useAuth } from '@/lib/auth'
import {
  CATEGORIES,
  SORT_LABEL,
  STATUS_LABEL,
  STATUS_ORDER,
  buildConnections,
  countByStatus,
  effectiveStatus,
  filterConnections,
  loadPrefs,
  resolveOpenConnection,
  savePrefs,
  sortConnections,
  withoutOpenParams,
  type CategoryFilter,
  type Connection,
  type SortKey,
  type StatusFilter,
  type ViewPrefs,
} from '@/lib/connections'
import { relativeAge, useIntegrationHealth } from '@/lib/health'
import { useIntegrations } from '@/lib/integrations'
import { PILL_BASE, PILL_OFF, PILL_ON } from '@/components/PillTabs'
import { cn } from '@/lib/utils'
import { CompanyMark, useKeyStatus } from '@/pages/settings/SetupKeys'
import { AppIssuesBanner } from './AppIssuesBanner'
import { MonitorCheck } from './FeedHealth'
import { StatusPill } from './StatusPill'
import { STATUS_CLASS } from './status-style'

const ConnectionDetail = lazy(() => import('./ConnectionDetail').then((m) => ({ default: m.ConnectionDetail })))

/** Re-read the clock once a minute, so "No data for 3 days" moves on its own. */
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}

const lastText = (c: Connection) =>
  c.lastDataAt ? relativeAge(c.lastDataAt) : c.waiting ? 'waiting' : c.def.tool ? 'manual' : '—'

function Row({ c, onOpen }: { c: Connection; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50">
        <CompanyMark group={c.def.keyGroup ?? c.name} category={c.category} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900">{c.name}</p>
          <p className="truncate text-xs text-gray-500">
            {c.reason ? <span className={cn('font-medium', STATUS_CLASS[c.status].text)}>{c.reason}</span> : c.category}
            {/* On a phone the last-data column folds into this line. */}
            <span className="sm:hidden"> · {lastText(c)}</span>
          </p>
        </div>
        <span className="hidden w-24 shrink-0 text-right text-xs tabular-nums text-gray-500 sm:block" title="Last data in">
          {lastText(c)}
        </span>
        <StatusPill status={c.status} className="hidden w-[7.5rem] text-center sm:inline-block" />
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full sm:hidden', {
          'bg-red-500': c.status === 'attention',
          'bg-gray-400': c.status === 'not_set_up',
          'bg-green-500': c.status === 'working',
          'bg-gray-200': c.status === 'off',
        })} aria-label={STATUS_LABEL[c.status]} />
        <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
      </button>
    </li>
  )
}

/**
 * Settings → Connections: every connection the farm has, in one list — the
 * old Integrations tab and Farm setup's keys cards merged (14 Oct 2026).
 * Problems first; tap one for everything about it. The registry and its
 * status rules are in lib/connections.ts.
 */
export function ConnectionsView() {
  const { profile } = useAuth()
  if (!hasManagerAccess(profile?.role)) {
    return <div className="p-6 text-sm text-gray-500">Only managers can manage integrations.</div>
  }
  return <ConnectionsList userId={profile?.id ?? null} isAdmin={hasAdminAccess(profile?.role)} />
}

function ConnectionsList({ userId, isAdmin }: { userId: string | null; isAdmin: boolean }) {
  const { data: keys } = useKeyStatus(isAdmin)
  const { data: accounts, isLoading: accountsLoading } = useIntegrations()
  const { data: health, isLoading: healthLoading, isError: healthFailed } = useIntegrationHealth()
  const now = useMinuteClock()
  const rows = useMemo(
    () => buildConnections({ keys: isAdmin ? keys : undefined, accounts, health, now }),
    [isAdmin, keys, accounts, health, now],
  )

  // Filters: remembered per person on this device.
  const [prefs, setPrefs] = useState<ViewPrefs>(() => loadPrefs(userId))
  const [chosen, setChosen] = useState<StatusFilter | null>(null)
  const [query, setQuery] = useState('')
  const remember = (patch: ViewPrefs) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    savePrefs(userId, next)
  }
  const counts = countByStatus(rows)
  const status = effectiveStatus(chosen, prefs.status, counts)
  const category: CategoryFilter = prefs.category ?? 'all'
  const sort: SortKey = prefs.sort ?? 'status'
  const shown = sortConnections(filterConnections(rows, { status, category, query }), sort)
  const categoriesHere = CATEGORIES.filter((cat) => rows.some((r) => r.category === cat))

  // Which detail is open comes from the address, so it can be linked to and Back closes it.
  const [params, setParams] = useSearchParams()
  const { hash } = useLocation()
  const openId = resolveOpenConnection(params, hash)
  const open = openId ? rows.find((r) => r.id === openId) : undefined
  const openConnection = (id: string) => {
    const next = withoutOpenParams(params)
    next.set('c', id)
    setParams(next)
  }
  const close = () => setParams(withoutOpenParams(params), { replace: true })

  const chips: StatusFilter[] = ['all', ...STATUS_ORDER]

  return (
    <div className="p-4 md:p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-3">
        <AppIssuesBanner />

        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((s) => (
            <button
              key={s}
              type="button"
              disabled={s !== 'all' && counts[s] === 0}
              onClick={() => {
                setChosen(s)
                remember({ status: s })
              }}
              aria-pressed={status === s}
              className={cn(PILL_BASE, 'disabled:opacity-40', status === s ? PILL_ON : cn(PILL_OFF, 'bg-white ring-1 ring-inset ring-gray-200'))}
            >
              {s === 'all' ? 'All' : STATUS_LABEL[s]} · {counts[s]}
            </button>
          ))}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <MonitorCheck isManager />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 basis-48">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search connections, feeds, keys"
              aria-label="Search connections"
              className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-2.5 text-sm"
            />
          </label>
          <Select
            value={category}
            ariaLabel="Category"
            className="w-44"
            onChange={(v) => remember({ category: v as CategoryFilter })}
            options={[
              { value: 'all', label: 'All categories' },
              ...categoriesHere.map((cat) => ({ value: cat, label: `${cat} (${rows.filter((r) => r.category === cat).length})` })),
            ]}
          />
          <Select
            value={sort}
            ariaLabel="Sort"
            className="w-40"
            onChange={(v) => remember({ sort: v as SortKey })}
            options={(Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({ value: k, label: `Sort: ${SORT_LABEL[k]}` }))}
          />
        </div>

        {/* Both are live-only (never restored from the offline cache), so with no signal they fail rather than load. */}
        {healthFailed && (
          <p className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
            Could not read the feed monitor, so feed problems are not shown. Check the connection and reload.
          </p>
        )}
        {healthLoading && accountsLoading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : shown.length ? (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
            {shown.map((c) => (
              <Row key={c.id} c={c} onOpen={() => openConnection(c.id)} />
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
            Nothing matches.{' '}
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setChosen('all')
                remember({ status: 'all', category: 'all' })
              }}
              className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
            >
              <X className="h-3.5 w-3.5" /> Clear filters
            </button>
          </div>
        )}
      </div>

      {open && (
        <Suspense fallback={null}>
          <ConnectionDetail connection={open} onClose={close} isAdmin={isAdmin} isManager />
        </Suspense>
      )}
    </div>
  )
}
