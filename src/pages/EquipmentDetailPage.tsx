import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Gauge, Save, Tractor } from 'lucide-react'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { EquipmentMaintenance } from '@/components/EquipmentMaintenance'
import { EquipmentWarranty } from '@/components/EquipmentWarranty'
import { EquipmentServiceLog } from '@/components/EquipmentServiceLog'
import { ManualEquipmentModal } from '@/components/EquipmentEditor'
import { EditButton } from '@/components/RecordEditor'
import { PillTabs } from '@/components/PillTabs'
import { InspectionView, TruckInspectionHistory } from '@/components/TruckInspection'
import { engineHoursLabel, useEquipment, useEquipmentItem, useSaveEquipment } from '@/lib/equipment'
import { hoursStaleSince, staleHoursLabel } from '@/lib/stale-hours'
import { equipmentKind, isInspected } from '@/lib/equipment-types'
import { useTruckInspections } from '@/lib/truck-inspection-data'
import { useTab } from '@/lib/useTab'
import { CARD_HEAD } from '@/lib/table-style'
import { cn } from '@/lib/utils'

type MachineTab = 'overview' | 'service' | 'warranty' | 'inspections'
const TABS: readonly MachineTab[] = ['overview', 'service', 'warranty', 'inspections']

/**
 * A truck's or trailer's yearly inspections (Sam, 24 Oct 2026: "when
 * clicking on an individual truck it gives you the truck inspection form as
 * an option"). The same rows and form as the Truck inspection checklist.
 */
function InspectionsTab({ machine }: { machine: { id: string; name: string | null; make: string | null; model: string | null } }) {
  const [params, setParams] = useSearchParams()
  const { data: inspections, isLoading } = useTruckInspections()
  const mine = (inspections ?? []).filter((i) => i.equipment_id === machine.id)
  const openId = params.get('inspection')
  const open = mine.find((i) => i.id === openId) ?? null
  const truck = { id: machine.id, name: machine.name ?? 'Unnamed', make: machine.make, model: machine.model }
  const show = (id: string | null) =>
    setParams((p) => {
      if (id) p.set('inspection', id)
      else p.delete('inspection')
      return p
    })
  if (isLoading) return <p className="mt-4 text-sm text-gray-500">Loading…</p>
  if (open) {
    return (
      <div className="mt-4 max-w-3xl space-y-3">
        <InspectionView key={open.id} inspection={open} truck={truck} backLabel="All inspections" onBack={() => show(null)} />
      </div>
    )
  }
  return (
    <div className="mt-4 max-w-3xl">
      <TruckInspectionHistory truck={truck} inspections={mine} onOpen={show} />
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] text-gray-400">{label}</dt>
      <dd className={value ? 'text-sm text-gray-800' : 'text-sm text-gray-300'}>
        {value ?? 'not recorded'}
      </dd>
    </div>
  )
}

/** One machine: what Deere knows, plus whatever we add ourselves. */
export function EquipmentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const canEdit = hasManagerAccess(profile?.role)
  const { data: e, isLoading } = useEquipmentItem(id)
  // The fleet, to tell this machine's silence from the whole sync's (lib/stale-hours.ts).
  const { data: fleet } = useEquipment()
  const save = useSaveEquipment()
  const [notes, setNotes] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  // Overview | Service | Warranty, and Inspections for trucks and trailers
  // (Sam, 24 Oct 2026). Its own remembered tab, apart from the fleet list.
  // Every tab is valid to useTab, so a ?tab=inspections link is not rewritten
  // while the machine is still loading; a machine without inspections shows
  // its overview instead.
  const [asked, setTab] = useTab('equipment-machine', TABS)
  const inspected = isInspected(e?.equipment_type)
  const tab: MachineTab = asked === 'inspections' && !inspected ? 'overview' : asked

  if (isLoading) return <p className="p-4 text-sm text-gray-500 md:p-6">Loading…</p>
  if (!e) return <p className="p-4 text-sm text-gray-500 md:p-6">That machine is not here.</p>

  const hours = engineHoursLabel(e)
  const staleSince = fleet ? hoursStaleSince(e, fleet) : null
  const draft = notes ?? e.notes ?? ''

  return (
    <div className="p-4 md:p-6">
      <Link
        to={`/equipment?type=${equipmentKind(e.equipment_type)}`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-700"
      >
        <ArrowLeft className="h-4 w-4" /> Equipment service
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* When Deere last sent this machine is sync housekeeping, so it is
            the heading's tooltip rather than a field beside the serial. */}
        <h1
          className="flex items-center gap-1.5 text-lg font-semibold text-gray-900"
          title={e.synced_at ? `Last synced from Deere ${new Date(e.synced_at).toLocaleString('en-CA')}` : undefined}
        >
          <Tractor className="h-5 w-5 text-brand-700" /> {e.name ?? 'Unnamed'}
        </h1>
        {e.category && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] capitalize text-gray-600">
            {e.category}
          </span>
        )}
        {e.archived && (
          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[11px] text-gray-700">
            {e.is_manual ? 'sold / archived' : 'archived in Deere'}
          </span>
        )}
        {e.is_manual && <span className="rounded bg-gray-100 px-1.5 text-[10px] text-gray-500">added by hand</span>}
        {canEdit && e.is_manual && (
          <span className="ml-auto">
            <EditButton onClick={() => setEditing(true)} />
          </span>
        )}
      </div>
      {editing && <ManualEquipmentModal machine={e} onClose={() => setEditing(false)} />}

      {hours && (
        <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-700">
          <Gauge className="h-4 w-4 text-gray-400" /> {hours}
          {staleSince && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">{staleHoursLabel(staleSince)}</span>}
        </p>
      )}

      <PillTabs
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'service', label: 'Service' },
          { key: 'warranty', label: 'Warranty' },
          ...(inspected ? [{ key: 'inspections' as const, label: 'Inspections' }] : []),
        ]}
        value={tab}
        onChange={setTab}
        className="mt-3"
      />

      {tab === 'overview' && (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-3">
            <Field label="Make" value={e.make} />
            <Field label="Model" value={e.model} />
            <Field label="Type" value={e.equipment_type} />
            <Field label="Serial number" value={e.serial_number} />
            <Field label="VIN" value={e.vin} />
          </dl>
          {/* The sync rewrites these on every run, so an edit here would not last. */}
          {!e.is_manual && canEdit && (
            <p className="mt-1 text-[11px] text-gray-400">From John Deere: change the name, make, model or serial in Operations Center. Notes, service and warranty are ours.</p>
          )}

          <div className="overflow-hidden mt-4 rounded-lg border border-gray-200 bg-white">
            <h2 className={cn('font-medium', CARD_HEAD)}>Notes</h2>
            <div className="p-4">
            <p className="mt-0.5 text-xs text-gray-500">
              Ours, not Deere&apos;s — a sync never overwrites this.
            </p>
            <textarea
              value={draft}
              onChange={(ev) => setNotes(ev.target.value)}
              disabled={!canEdit}
              rows={4}
              placeholder="Anything worth knowing about this machine…"
              className="mt-2 w-full rounded-md border border-gray-300 p-2 text-sm disabled:bg-gray-50"
            />
            {canEdit && (
              <button
                onClick={() => save.mutate({ id: e.id, notes: draft.trim() || null })}
                disabled={save.isPending || draft === (e.notes ?? '')}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                <Save className="h-4 w-4" /> Save notes
              </button>
            )}

            </div>
          </div>
        </>
      )}
      {tab === 'service' && (
        <>
          <EquipmentMaintenance equipment={e} canEdit={canEdit} canLog={Boolean(profile?.active)} hoursStaleSince={staleSince} />
          <EquipmentServiceLog equipment={e} canEdit={canEdit} canAdd={Boolean(profile?.active)} />
        </>
      )}
      {tab === 'warranty' && <EquipmentWarranty e={e} canEdit={canEdit} />}
      {tab === 'inspections' && inspected && <InspectionsTab machine={e} />}
    </div>
  )
}
