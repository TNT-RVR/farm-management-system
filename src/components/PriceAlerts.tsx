import { useState } from 'react'
import { Bell, BellRing, Plus, Trash2 } from 'lucide-react'
import {
  useDeleteMarketAlert,
  useMarketAlerts,
  useSaveMarketAlert,
  type MarketSeries,
} from '@/lib/markets'
import { cn } from '@/lib/utils'
import { rowClick } from '@/components/RecordEditor'
import { watchNeedsRearm } from '@/lib/record-edits'

const input = 'rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-900'

/**
 * Price watches — crop feature 7 and cattle C10.
 *
 * A watch fires ONCE per crossing, not once per reading. A price that goes over
 * the line and stays there is still over it next Friday, and an alert that
 * repeats weekly is one nobody reads by the third time. The badge shows whether
 * a watch is armed so that behaviour is visible rather than surprising.
 */
export function PriceAlerts({
  series,
  isManager,
}: {
  /** The series a watch can be set on — whatever the tab is showing. */
  series: MarketSeries[]
  isManager: boolean
}) {
  const { data: alerts } = useMarketAlerts()
  const save = useSaveMarketAlert()
  const del = useDeleteMarketAlert()
  const [adding, setAdding] = useState(false)
  // A watch opened to change it (Sam, 7 Oct 2026); the same form as adding one.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [d, setD] = useState({
    series_id: '',
    direction: 'above' as 'above' | 'below',
    threshold: '',
  })

  const relevant = (alerts ?? []).filter((a) => series.some((s) => s.id === a.series_id))
  const nameOf = (id: string) => series.find((s) => s.id === id)?.name ?? 'a price'
  const unitOf = (id: string) => series.find((s) => s.id === id)?.unit ?? ''

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <Bell className="h-4 w-4 text-gray-400" /> Price watches
        </h3>
        {isManager && !adding && series.length > 0 && (
          <button
            onClick={() => {
              setD({ series_id: series[0].id, direction: 'above', threshold: '' })
              setEditingId(null)
              setAdding(true)
            }}
            className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Plus className="h-3.5 w-3.5" /> Watch a price
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md bg-gray-50 p-2">
          <label className="text-xs text-gray-500">
            Series
            <select
              className={cn(input, 'mt-0.5 block max-w-64')}
              value={d.series_id}
              onChange={(e) => setD({ ...d, series_id: e.target.value })}
            >
              {series.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500">
            Goes
            <select
              className={cn(input, 'mt-0.5 block')}
              value={d.direction}
              onChange={(e) => setD({ ...d, direction: e.target.value as 'above' | 'below' })}
            >
              <option value="above">above</option>
              <option value="below">below</option>
            </select>
          </label>
          <label className="text-xs text-gray-500">
            {unitOf(d.series_id) || 'Value'}
            <input
              className={cn(input, 'mt-0.5 block w-28')}
              inputMode="decimal"
              value={d.threshold}
              onChange={(e) => setD({ ...d, threshold: e.target.value })}
            />
          </label>
          <button
            disabled={!Number.isFinite(Number(d.threshold)) || !d.threshold.trim()}
            onClick={async () => {
              const was = relevant.find((a) => a.id === editingId)
              const next = { series_id: d.series_id, direction: d.direction, threshold: Number(d.threshold) }
              await save.mutateAsync({
                ...next,
                ...(was ? { id: was.id, ...(watchNeedsRearm(was, next) || was.series_id !== next.series_id ? { armed: true } : {}) } : {}),
              })
              setAdding(false)
              setEditingId(null)
            }}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={() => {
              setAdding(false)
              setEditingId(null)
            }}
            className="rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          {editingId && <span className="text-[11px] text-gray-400">A moved line arms the watch again.</span>}
        </div>
      )}

      {relevant.length === 0 ? (
        <p className="mt-1 text-xs text-gray-500">
          None set. A watch tells the managers once when a price crosses your line, then stays quiet
          until it comes back — so it will not nag you every week the price sits there.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100">
          {relevant.map((a) => (
            <li
              key={a.id}
              onClick={
                isManager
                  ? rowClick(() => {
                      setD({ series_id: a.series_id, direction: a.direction, threshold: String(a.threshold) })
                      setEditingId(a.id)
                      setAdding(true)
                    })
                  : undefined
              }
              className={cn(
                'flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm',
                isManager && 'cursor-pointer hover:bg-gray-50',
                editingId === a.id && 'bg-brand-50',
              )}
            >
              {a.armed ? (
                <Bell className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              ) : (
                <BellRing className="h-3.5 w-3.5 shrink-0 text-amber-600" />
              )}
              <span className="text-gray-800">{nameOf(a.series_id)}</span>
              <span className="text-gray-500">
                {a.direction} <span className="font-semibold tabular-nums">{a.threshold}</span>{' '}
                {unitOf(a.series_id)}
              </span>
              {a.last_fired_at && (
                <span className="text-[11px] text-gray-400">
                  fired {a.last_fired_at.slice(0, 10)} at {a.last_fired_value}
                  {!a.armed && ' · quiet until it comes back'}
                </span>
              )}
              {isManager && (
                <button
                  onClick={() => {
                    if (!confirm(`Remove the watch on ${nameOf(a.series_id)}?`)) return
                    if (editingId === a.id) {
                      setEditingId(null)
                      setAdding(false)
                    }
                    del.mutate(a.id)
                  }}
                  className="ml-auto rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="Remove watch"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
