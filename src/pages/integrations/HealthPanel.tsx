import { Activity, RefreshCw } from 'lucide-react'
import {
  monitorIsStale,
  monitorLastRun,
  relativeAge,
  useIntegrationHealth,
  useRunHealthCheck,
  useSetIntegrationHealth,
  type HealthRow,
} from '@/lib/health'
import { InfoPopover } from '@/components/InfoPopover'
import { cn } from '@/lib/utils'

const STATUS_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  ok: { dot: 'bg-green-500', text: 'text-green-700', label: 'OK' },
  stale: { dot: 'bg-amber-500', text: 'text-amber-700', label: 'Stale' },
  error: { dot: 'bg-red-500', text: 'text-red-700', label: 'Error' },
  unknown: { dot: 'bg-gray-300', text: 'text-gray-500', label: 'Waiting' },
}

function HealthLine({ r, isManager }: { r: HealthRow; isManager: boolean }) {
  const set = useSetIntegrationHealth()
  const disabled = !r.enabled
  const s = STATUS_STYLE[disabled ? 'unknown' : r.status] ?? STATUS_STYLE.unknown
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 py-2.5 last:border-0">
      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', disabled ? 'bg-gray-200' : s.dot)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900">
          {r.label}
          <span className="ml-1.5 text-[11px] font-normal uppercase tracking-wide text-gray-400">
            {r.category}
          </span>
        </p>
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

export function HealthPanel({ isManager }: { isManager: boolean }) {
  const { data: rows } = useIntegrationHealth()
  const run = useRunHealthCheck()
  const lastRun = monitorLastRun(rows)
  // If the monitor itself hasn't run in >2 h, the watchdog may be down — surface it.
  const monitorStale = monitorIsStale(lastRun)
  const anyBad = (rows ?? []).some(
    (r) => r.enabled && (r.status === 'stale' || r.status === 'error'),
  )

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 font-semibold text-gray-900">
            <Activity className={cn('h-4 w-4', anyBad ? 'text-red-600' : 'text-green-600')} /> Feed
            &amp; integration health
            <InfoPopover title="Feed & integration health">
              <p>
                Checked automatically every hour. Managers are alerted (in-app + push) the moment a
                feed goes stale, errors, or disconnects — and again when it recovers.
              </p>
              <p>Monitor last ran {relativeAge(lastRun)}.</p>
            </InfoPopover>
          </h3>
        </div>
        {isManager && (
          <button
            onClick={() => run.mutate()}
            disabled={run.isPending}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', run.isPending && 'animate-spin')} /> Check now
          </button>
        )}
      </div>

      {/* Watchdog-of-the-watchdog: a dead monitor is itself visible here. The
          push prompt that sat above it now lives only in Settings → My account →
          Notifications, so it is asked for in one place. */}
      {monitorStale && (
        <div className="mb-2 mt-3 flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          Monitor last ran {relativeAge(lastRun)} — expected hourly. If this stays stale, the health
          job may be down.
        </div>
      )}

      <div className="mt-2">
        {(rows ?? []).map((r) => (
          <HealthLine key={r.id} r={r} isManager={isManager} />
        ))}
        {run.isSuccess && (
          <p className="pt-2 text-xs text-green-700">
            Checked {run.data.checked} sources just now.
          </p>
        )}
        {run.isError && <p className="pt-2 text-xs text-red-700">{(run.error as Error).message}</p>}
      </div>
    </div>
  )
}
