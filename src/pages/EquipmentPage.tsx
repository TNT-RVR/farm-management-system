import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Gauge, RefreshCw, Search, ShieldCheck, Tractor, Wrench } from 'lucide-react'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import {
  categoryRank,
  engineHoursLabel,
  useEquipment,
  useSyncEquipment,
  type Equipment,
} from '@/lib/equipment'
import { WARRANTY_STYLE, warrantyStatus } from '@/lib/warranty'
import { AddButton } from '@/components/RecordEditor'
import { ManualEquipmentModal } from '@/components/EquipmentEditor'
import { cn } from '@/lib/utils'

const CATEGORY_LABEL: Record<string, string> = {
  machine: 'Machines',
  implement: 'Implements',
  technology: 'Technology',
  other: 'Other',
}
const CATEGORY_STYLE: Record<string, string> = {
  machine: 'bg-green-100 text-green-800',
  implement: 'bg-amber-100 text-amber-800',
  technology: 'bg-sky-100 text-sky-800',
}

/** Make, model and type without repeating whatever is already in the name. */
function describe(e: Equipment): string {
  const parts = [e.make, e.model, e.equipment_type].filter(Boolean) as string[]
  const name = (e.name ?? '').toLowerCase()
  const fresh = parts.filter((p) => !name.includes(p.toLowerCase()))
  return fresh.join(' · ')
}

function EquipmentRow({ e }: { e: Equipment }) {
  const hours = engineHoursLabel(e)
  const detail = describe(e)
  const warranty = warrantyStatus(e)
  return (
    <li>
      <Link
        to={`/equipment/${e.id}`}
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-gray-100 px-3 py-2.5 hover:bg-gray-50"
      >
        <span className="font-medium text-gray-900">{e.name ?? 'Unnamed'}</span>
        {detail && <span className="text-xs text-gray-500">{detail}</span>}
        {e.is_manual && (
          <span className="rounded bg-gray-100 px-1.5 text-[10px] text-gray-500">added by hand</span>
        )}
        {/* Only where it is worth acting on. A machine with three years left
            does not need a badge on every scroll past it — it is the ones
            running out that this list is being scanned for. */}
        {(warranty.state === 'soon' || warranty.state === 'expired') && (
          <span
            className={cn(
              'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
              WARRANTY_STYLE[warranty.state],
            )}
          >
            <ShieldCheck className="h-3 w-3" />
            {warranty.label}
          </span>
        )}
        <span className="ml-auto flex items-center gap-3 text-xs tabular-nums text-gray-600">
          {hours ? (
            <span className="flex items-center gap-1">
              <Gauge className="h-3.5 w-3.5 text-gray-400" /> {hours}
            </span>
          ) : (
            // Not a gap in the sync: a towed implement has no engine to report.
            <span className="text-gray-300">no hours reported</span>
          )}
        </span>
      </Link>
    </li>
  )
}

/** The fleet, grouped the way you would walk the yard. */
export function EquipmentPage() {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const [showArchived, setShowArchived] = useState(false)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const { data: all, isLoading } = useEquipment(showArchived)
  const sync = useSyncEquipment()

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rows = (all ?? []).filter(
      (e) =>
        !needle ||
        [e.name, e.make, e.model, e.equipment_type, e.serial_number, e.vin]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(needle)),
    )
    const byCategory = new Map<string, Equipment[]>()
    for (const e of rows) {
      const key = (e.category ?? 'other').toLowerCase()
      byCategory.set(key, [...(byCategory.get(key) ?? []), e])
    }
    return [...byCategory.entries()].sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]))
  }, [all, q])

  const total = all?.length ?? 0
  const withHours = (all ?? []).filter((e) => e.engine_hours != null).length
  // Counted over the WHOLE fleet, not the filtered view: the point of the line
  // is to say there is something to deal with even while you are searching for
  // something else.
  const endingSoon = (all ?? []).filter((e) => warrantyStatus(e).state === 'soon').length

  return (
    <div className="p-4 md:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-1.5 text-lg font-semibold text-gray-900">
            <Tractor className="h-5 w-5 text-brand-700" /> Equipment
          </h1>
          <p className="text-xs text-gray-500">
            {total} machines and implements, from Deere
            {withHours > 0 && ` · ${withHours} reporting engine hours`}
            {endingSoon > 0 && (
              <span className="font-medium text-amber-700">
                {' · '}
                {endingSoon} {endingSoon === 1 ? 'warranty' : 'warranties'} running out
              </span>
            )}
          </p>
        </div>
        {isManager && (
          <div className="flex flex-wrap items-center gap-2">
            {/* For what Deere does not know about: the shop tractor, an auger, a trailer. */}
            <AddButton label="Add by hand" onClick={() => setAdding(true)} />
            <button
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
              className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={cn('h-4 w-4', sync.isPending && 'animate-spin')} />
              Sync from Deere
            </button>
          </div>
        )}
      </div>
      {adding && <ManualEquipmentModal machine={null} onClose={() => setAdding(false)} />}

      {sync.isError && <p className="mb-2 text-xs text-red-600">{(sync.error as Error).message}</p>}
      {sync.isSuccess && (
        <p className="mb-2 text-xs text-gray-500">
          Pulling equipment and engine hours — the list fills in as it goes.
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, make, model, serial or VIN…"
            className="w-full rounded-md border border-gray-300 py-2 pl-8 pr-3 text-sm"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Include sold / archived
        </label>
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-gray-400">Loading…</p>
      ) : total === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-10 text-center">
          <Wrench className="mx-auto h-6 w-6 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">
            No equipment yet.{' '}
            {isManager
              ? 'Press "Sync from Deere" to bring it in.'
              : 'A manager can sync it from Deere.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(([category, rows]) => (
            <section key={category} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <h2 className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] font-medium capitalize',
                    CATEGORY_STYLE[category] ?? 'bg-gray-100 text-gray-600',
                  )}
                >
                  {CATEGORY_LABEL[category] ?? category}
                </span>
                <span className="font-normal normal-case text-gray-400">{rows.length}</span>
              </h2>
              <ul>
                {rows.map((e) => (
                  <EquipmentRow key={e.id} e={e} />
                ))}
              </ul>
            </section>
          ))}
          {groups.length === 0 && (
            <p className="rounded-lg border border-gray-200 bg-white px-3 py-8 text-center text-sm text-gray-400">
              Nothing matched “{q}”.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
