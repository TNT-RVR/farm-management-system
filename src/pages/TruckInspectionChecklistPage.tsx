import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ClipboardCheck } from 'lucide-react'
import { Select } from '@/components/Select'
import { InspectionView, TruckInspectionHistory } from '@/components/TruckInspection'
import { useInspectedVehicles, useTruckInspections, vehicleOptions } from '@/lib/truck-inspection-data'
import { progress } from '@/lib/truck-inspection'

/**
 * The Truck inspection checklist (Sam, 24 Oct 2026: "a generic form under
 * checklists that they can then select the truck from a drop down selector on
 * the form to have it apply to that truck"). Not a checklist template: it is
 * the same yearly inspection, saved on the same truck_inspections row, as the
 * truck's Inspections tab on Equipment service. Picking the truck here is
 * picking which truck's row it is.
 *
 * ?inspection=<id> opens one (old /truck-inspections?inspection= links land
 * here); ?truck=<id> preselects the truck.
 */
export function TruckInspectionChecklistPage() {
  const [params, setParams] = useSearchParams()
  const { data: vehicles, isLoading } = useInspectedVehicles()
  const { data: inspections } = useTruckInspections()
  const openId = params.get('inspection')
  const truckId = params.get('truck') ?? ''
  const open = (inspections ?? []).find((i) => i.id === openId) ?? null
  const set = (patch: Record<string, string | null>) =>
    setParams((p) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v) p.set(k, v)
        else p.delete(k)
      }
      return p
    })

  if (open) {
    const truck = (vehicles ?? []).find((t) => t.id === open.equipment_id) ?? null
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-4 md:p-6">
        <InspectionView
          key={open.id}
          inspection={open}
          truck={truck}
          vehicles={vehicles ?? []}
          backLabel="Truck inspection"
          onBack={() => set({ inspection: null, truck: open.equipment_id })}
          onMoved={(id) => set({ truck: id })}
        />
      </div>
    )
  }

  const truck = (vehicles ?? []).find((t) => t.id === truckId) ?? null
  // The drafts, so one started last week is a tap away without remembering
  // which truck it was (page-walk batch 6: Checklists said "2 in progress"
  // and this page showed only the picker).
  const vehicleName = new Map((vehicles ?? []).map((v) => [v.id, v.name]))
  const drafts = (inspections ?? [])
    .filter((i) => !i.signed_at && i.equipment_id !== truck?.id)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4 md:p-6">
      <Link to="/checklists" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Checklists
      </Link>
      <h1 className="flex items-center gap-1.5 text-lg font-semibold text-gray-900">
        <ClipboardCheck className="h-5 w-5 text-brand-700" /> Truck inspection
      </h1>
      <p className="text-xs text-gray-500">Each semi once a year. Pick the truck or trailer; it shows on that one’s Inspections tab.</p>
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !vehicles?.length ? (
        <p className="text-sm text-gray-500">
          No trucks yet. Add them on{' '}
          <Link to="/equipment" className="text-brand-700 underline">
            Equipment service
          </Link>{' '}
          with the type Truck.
        </p>
      ) : (
        <>
          <Select
            value={truckId}
            ariaLabel="Truck or trailer"
            placeholder="Pick the truck or trailer…"
            className="w-full sm:w-72"
            onChange={(id) => set({ truck: id })}
            options={vehicleOptions(vehicles)}
          />
          {drafts.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-sm font-semibold text-gray-900">In progress</p>
              <ul className="mt-1 divide-y divide-gray-100 text-sm">
                {drafts.map((i) => {
                  const p = progress(i.answers)
                  return (
                    <li key={i.id}>
                      <button
                        type="button"
                        onClick={() => set({ inspection: i.id })}
                        className="flex w-full flex-wrap items-baseline justify-between gap-x-3 py-1.5 text-left hover:text-brand-800"
                      >
                        <span className="font-medium">{vehicleName.get(i.equipment_id) ?? 'A truck no longer listed'}</span>
                        <span className="text-xs text-gray-500">
                          started{' '}
                          {new Date(i.started_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {' · '}
                          {p.done} of {p.total} checked
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {truck && (
            <>
              <TruckInspectionHistory
                truck={truck}
                inspections={(inspections ?? []).filter((i) => i.equipment_id === truck.id)}
                onOpen={(id) => set({ inspection: id })}
              />
              <Link to={`/equipment/${truck.id}?tab=inspections`} className="block text-xs text-brand-700 hover:underline">
                Open {truck.name} on Equipment service
              </Link>
            </>
          )}
        </>
      )}
    </div>
  )
}

/**
 * /truck-inspections, its own page until 24 Oct 2026: the trucks on Equipment
 * service, or with ?inspection=<id> that inspection on the checklist form.
 */
export function TruckInspectionsRedirect() {
  const [params] = useSearchParams()
  const id = params.get('inspection')
  return <Navigate to={id ? `/checklists/truck-inspection?inspection=${encodeURIComponent(id)}` : '/equipment?type=trucks'} replace />
}
