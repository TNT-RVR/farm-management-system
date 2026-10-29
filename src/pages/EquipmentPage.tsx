import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ClipboardCheck, Gauge, RefreshCw, Search, ShieldCheck, Tractor, Wrench } from 'lucide-react'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import {
  categoryRank,
  engineHoursLabel,
  useAllServicePlans,
  useEquipment,
  useSyncEquipment,
  type Equipment,
} from '@/lib/equipment'
import { serviceSummary } from '@/lib/maintenance'
import { WARRANTY_STYLE, warrantyStatus } from '@/lib/warranty'
import { staleHoursLabel, staleHoursMachines } from '@/lib/stale-hours'
import { equipmentKind, kindOptions } from '@/lib/equipment-types'
import { isDue } from '@/lib/truck-inspection'
import { useTruckInspections } from '@/lib/truck-inspection-data'
import { localDateKey } from '@/lib/ranchWeather'
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

function EquipmentRow({
  e,
  service,
  staleSince,
  inspectionDue,
}: {
  e: Equipment
  service: { overdue: number; dueSoon: number } | undefined
  /** When its hours stopped updating (lib/stale-hours.ts), else null. */
  staleSince: string | null
  /** A semi with no yearly inspection signed off this year. */
  inspectionDue: boolean
}) {
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
        {/* Like the warranty badge: only when there is something to do. */}
        {service && (service.overdue > 0 || service.dueSoon > 0) && (
          <span
            className={cn(
              'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
              service.overdue > 0 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800',
            )}
          >
            <Wrench className="h-3 w-3" />
            {service.overdue > 0
              ? `${service.overdue} service${service.overdue === 1 ? '' : 's'} overdue`
              : `${service.dueSoon} service${service.dueSoon === 1 ? '' : 's'} due soon`}
          </span>
        )}
        {inspectionDue && (
          <span className="flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
            <ClipboardCheck className="h-3 w-3" />
            Inspection due
          </span>
        )}
        {staleSince && (
          <span className="flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
            <Gauge className="h-3 w-3" />
            {staleHoursLabel(staleSince)}
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

/**
 * Equipment service: the fleet, grouped the way you would walk the yard, with
 * a filter by kind (Sam, 24 Oct 2026: "a way to filter to see the trucks").
 * The kind is in the address (?type=trucks), so the January inspection
 * reminder and the old /truck-inspections links land on the trucks.
 */
export function EquipmentPage() {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const [showArchived, setShowArchived] = useState(false)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const { data: all, isLoading } = useEquipment(showArchived)
  const sync = useSyncEquipment()
  const { data: plans } = useAllServicePlans()
  const { data: inspections } = useTruckInspections()
  const [params, setParams] = useSearchParams()
  const kinds = useMemo(() => kindOptions((all ?? []).map((e) => e.equipment_type)), [all])
  const askedKind = params.get('type') ?? 'all'
  // A kind the fleet has none of (in this view) shows everything rather than nothing.
  const kind = kinds.some((k) => k.key === askedKind) ? askedKind : 'all'
  const setKind = (k: string) =>
    setParams(
      (p) => {
        if (k === 'all') p.delete('type')
        else p.set('type', k)
        return p
      },
      { replace: true },
    )

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rows = (all ?? []).filter(
      (e) =>
        (kind === 'all' || equipmentKind(e.equipment_type) === kind) &&
        (!needle ||
        [e.name, e.make, e.model, e.equipment_type, e.serial_number, e.vin]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(needle))),
    )
    const byCategory = new Map<string, Equipment[]>()
    for (const e of rows) {
      const key = (e.category ?? 'other').toLowerCase()
      byCategory.set(key, [...(byCategory.get(key) ?? []), e])
    }
    return [...byCategory.entries()].sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]))
  }, [all, q, kind])

  const total = all?.length ?? 0
  const withHours = (all ?? []).filter((e) => e.engine_hours != null).length
  // Counted over the WHOLE fleet, not the filtered view: the point of the line
  // is to say there is something to deal with even while you are searching for
  // something else.
  const endingSoon = (all ?? []).filter((e) => warrantyStatus(e).state === 'soon').length
  const serviceByMachine = useMemo(() => {
    const byId = new Map<string, NonNullable<typeof plans>>()
    for (const p of plans ?? []) byId.set(p.equipment_id, [...(byId.get(p.equipment_id) ?? []), p])
    return new Map((all ?? []).map((e) => [e.id, serviceSummary(byId.get(e.id) ?? [], e.engine_hours)]))
  }, [plans, all])
  const servicesDue = [...serviceByMachine.values()].reduce((n, s) => n + s.overdue + s.dueSoon, 0)
  const staleHours = useMemo(() => staleHoursMachines(all ?? []), [all])
  // The semis the January reminder would name: type Truck, nothing signed this year.
  const inspectionDue = useMemo(() => {
    const year = Number(localDateKey().slice(0, 4))
    const last = new Map<string, string>()
    for (const i of inspections ?? []) {
      if (i.signed_on && i.signed_on > (last.get(i.equipment_id) ?? '')) last.set(i.equipment_id, i.signed_on)
    }
    return new Set((all ?? []).filter((e) => e.equipment_type === 'Truck' && !e.archived && isDue(last.get(e.id), year)).map((e) => e.id))
  }, [inspections, all])

  return (
    <div className="p-4 md:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-1.5 text-lg font-semibold text-gray-900">
            <Tractor className="h-5 w-5 text-brand-700" /> Equipment service
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
            {servicesDue > 0 && (
              <span className="font-medium text-amber-700">
                {' · '}
                {servicesDue} {servicesDue === 1 ? 'service' : 'services'} due
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
      {kinds.length > 2 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by kind">
          {kinds.map((k) => (
            <button
              key={k.key}
              type="button"
              aria-pressed={kind === k.key}
              onClick={() => setKind(k.key)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs',
                kind === k.key ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
              )}
            >
              {k.label} <span className={kind === k.key ? 'text-white/80' : 'text-gray-400'}>{k.count}</span>
            </button>
          ))}
        </div>
      )}
      {(kind === 'trucks' || kind === 'trailers') && (
        <p className="mb-3 text-xs text-gray-600">
          Open a truck or trailer for its yearly inspection, or use the{' '}
          <Link to="/checklists/truck-inspection" className="font-medium text-brand-700 hover:underline">
            Truck inspection checklist
          </Link>
          .
        </p>
      )}

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
                  <EquipmentRow
                    key={e.id}
                    e={e}
                    service={serviceByMachine.get(e.id)}
                    staleSince={staleHours.get(e.id) ?? null}
                    inspectionDue={inspectionDue.has(e.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
          {groups.length === 0 && (
            <p className="rounded-lg border border-gray-200 bg-white px-3 py-8 text-center text-sm text-gray-400">
              {q ? `Nothing matched “${q}”.` : 'Nothing of that kind.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
