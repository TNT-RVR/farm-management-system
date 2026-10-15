import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import {
  monitorIsStale,
  monitorLastRun,
  relativeAge,
  useIntegrationHealth,
  useRunHealthCheck,
  useSetIntegrationHealth,
  type HealthRow,
} from '@/lib/health'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const STATUS_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  ok: { dot: 'bg-green-500', text: 'text-green-700', label: 'OK' },
  stale: { dot: 'bg-amber-500', text: 'text-amber-700', label: 'Stale' },
  error: { dot: 'bg-red-500', text: 'text-red-700', label: 'Error' },
  unknown: { dot: 'bg-gray-300', text: 'text-gray-500', label: 'Waiting' },
}

/**
 * One monitored feed: its state as the hourly monitor last judged it, and —
 * for managers — the alert window and the monitoring switch. The line from
 * the old Feed & integration health list, now inside the connection it
 * belongs to.
 */
export function FeedHealthLine({ r, isManager }: { r: HealthRow; isManager: boolean }) {
  const set = useSetIntegrationHealth()
  const disabled = !r.enabled
  const s = STATUS_STYLE[disabled ? 'unknown' : r.status] ?? STATUS_STYLE.unknown
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 py-2.5 last:border-0">
      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', disabled ? 'bg-gray-200' : s.dot)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900">{r.label}</p>
        <p className="text-xs text-gray-500">
          {disabled ? (
            'Not connected — monitoring off'
          ) : (
            <>
              <span className={cn('font-medium', s.text)}>{s.label}</span>
              {r.detail ? ` · ${r.detail}` : ''}
              {r.check_kind === 'probe'
                ? ` · newest data ${relativeAge(r.data_at)}`
                : ` · last success ${relativeAge(r.last_success_at)}`}
            </>
          )}
        </p>
      </div>
      {isManager && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <label
            className="flex items-center gap-1"
            title="Alert if no fresh data within this many hours"
          >
            <span>alert &gt;</span>
            <input
              type="number"
              min={1}
              defaultValue={Math.round(r.stale_after_min / 60)}
              onBlur={(e) => {
                const hrs = Number(e.target.value)
                if (hrs > 0 && hrs * 60 !== r.stale_after_min)
                  set.mutate({ id: r.id, patch: { stale_after_min: Math.round(hrs * 60) } })
              }}
              className="w-14 rounded-md border border-gray-200 px-1.5 py-0.5 text-right tabular-nums"
            />
            <span>h</span>
          </label>
          <button
            onClick={() => set.mutate({ id: r.id, patch: { enabled: !r.enabled } })}
            className={cn(
              'rounded-md border px-2 py-0.5 font-medium',
              r.enabled
                ? 'border-gray-200 text-gray-600 hover:bg-gray-50'
                : 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100',
            )}
          >
            {r.enabled ? 'Monitoring' : 'Off'}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The monitor itself: run it now, and say so when it has not run in two
 * hours (the watchdog of the watchdog). Sits over the list.
 */
export function MonitorCheck({ isManager }: { isManager: boolean }) {
  const { data: rows } = useIntegrationHealth()
  const run = useRunHealthCheck()
  const lastRun = monitorLastRun(rows)
  const monitorStale = Boolean(rows?.length) && monitorIsStale(lastRun)
  return (
    <>
      {isManager && (
        <button
          onClick={() => run.mutate()}
          disabled={run.isPending}
          title={`Checked automatically every hour; last ran ${relativeAge(lastRun)}.`}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', run.isPending && 'animate-spin')} /> Check now
        </button>
      )}
      {run.isSuccess && <span className="text-xs text-green-700">Checked {run.data.checked} sources just now.</span>}
      {run.isError && <span className="text-xs text-red-700">{(run.error as Error).message}</span>}
      {monitorStale && (
        <p className="basis-full rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          Monitor last ran {relativeAge(lastRun)} — expected hourly. If this stays stale, the health
          job may be down.
        </p>
      )}
    </>
  )
}

type AlertNote = { id: string; title: string; body: string | null; created_at: string }

/**
 * The alerts and recoveries the monitor sent about these feeds — the same
 * notifications that reached this person's phone, so the history is theirs
 * and needs nothing stored beside it.
 */
export function FeedHistory({ sourceKeys }: { sourceKeys: string[] }) {
  const { data, isLoading } = useQuery({
    // Versioned: a new shape in the offline cache.
    queryKey: ['connection-history', 'v1', [...sourceKeys].sort().join(',')],
    enabled: sourceKeys.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, title, body, created_at')
        .eq('kind', 'integration_alert')
        .in('details->>source_key', sourceKeys)
        .order('created_at', { ascending: false })
        .limit(12)
      if (error) throw error
      return (data ?? []) as AlertNote[]
    },
  })
  if (!sourceKeys.length) return null
  if (isLoading) return <p className="text-xs text-gray-400">Loading…</p>
  if (!data?.length) return <p className="text-xs text-gray-500">No alerts sent about it.</p>
  return (
    <ul className="space-y-1">
      {data.map((n) => (
        <li key={n.id} className="text-xs">
          <span className="text-gray-400">
            {new Date(n.created_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}
          </span>{' '}
          <span className={cn('font-medium', n.title.startsWith('✓') ? 'text-green-700' : 'text-amber-800')}>{n.title}</span>
          {n.body && <span className="text-gray-500"> · {n.body}</span>}
        </li>
      ))}
    </ul>
  )
}
