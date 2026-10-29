import { useMemo, useState } from 'react'
import { Truck } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import { useCrops, useCropVarieties } from '@/lib/queries'
import { useBinMovements, useBinOnHand, type BinRow } from '@/lib/bins'
import { currentFill, fieldsLeaving } from '@/lib/bin-fill'
import { useBinContents } from '@/lib/bin-contents'
import { useAddDeliverySite, useDeliverySites } from '@/lib/bin-loads'
import { useHaulPlans } from '@/lib/hauling-data'
import { companyOf } from '@/lib/crop-label'
import { cropForVariety } from '@/lib/crop-variety-settings'
import { useCropVarietySettings } from '@/lib/crop-variety-settings-data'
import { bushelWeightFor, convertMass, MASS_UNITS, type MassUnit } from '@/lib/bushels'
import { ALL_OF_IT_BU, destinationFromPlan, destinationReady, destinationText, shipmentRows, type Destination } from '@/lib/bin-shipping'
import { useShipOut } from '@/lib/bin-shipping-data'
import { cn } from '@/lib/utils'

const input = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none'
const pill = (on: boolean) =>
  cn('flex-1 rounded-md border px-2 py-1.5 text-xs', on ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50')

/**
 * Shipping grain out of a bin (Sam, 26 Oct 2026): all of it or some, and
 * where it went — hauled to a plant or elevator, or picked up at our yard by
 * the buyer (a seed company taking its canola). Written as one shipment per
 * field the grain came from, oldest loads first (bin-shipping.ts), so each
 * field's deliveries add up.
 */
export function ShipOut({ from, cropYear, onClose }: { from: BinRow; cropYear: number; onClose: () => void }) {
  const { data: crops } = useCrops()
  const { data: varieties } = useCropVarieties()
  const { data: varietySettings } = useCropVarietySettings()
  const { data: contents } = useBinContents()
  const { data: onHand } = useBinOnHand()
  const { data: moves } = useBinMovements(from.id)
  const { data: sites } = useDeliverySites()
  const { data: plans } = useHaulPlans(cropYear)
  const addSite = useAddDeliverySite()
  const ship = useShipOut()

  // What is in the bin, by crop: only that can be shipped.
  const held = useMemo(
    () =>
      (onHand ?? [])
        .filter((o) => o.bin_id === from.id && o.onhand_bu > 0)
        .map((o) => ({ cropId: o.crop_id ?? '', bushels: o.onhand_bu, name: (crops ?? []).find((c) => c.id === o.crop_id)?.name ?? 'Unknown crop' })),
    [onHand, from.id, crops],
  )
  const [cropId, setCropId] = useState('')
  const source = held.find((h) => h.cropId === cropId) ?? held[0]
  const content = (contents ?? []).find((c) => c.bin_id === from.id && c.crop_id === source?.cropId) ?? null
  const listed = (crops ?? []).find((c) => c.id === source?.cropId)
  const crop = listed ? cropForVariety(listed, content?.variety ?? null, varietySettings) : undefined
  const lbPerBu = crop ? (bushelWeightFor(crop.name, crop.test_weight_lb_per_bu)?.lbPerBu ?? null) : null

  const [all, setAll] = useState(true)
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState<MassUnit>('bu')
  const typed = convertMass(Number(amount), unit, 'bu', lbPerBu)
  const bushels = all ? (source?.bushels ?? null) : typed
  const allOfIt = !!source && bushels != null && bushels >= source.bushels - ALL_OF_IT_BU

  // Whose grain goes: the bin empties oldest first.
  const lots = useMemo(() => currentFill(moves ?? []), [moves])
  const leavingFields = bushels != null ? fieldsLeaving(lots, bushels) : []

  // The first guess at where it goes: the haul plan of the field it came from.
  const company =
    companyOf(varieties, source?.cropId, content?.variety) ?? (listed?.name.match(/^(\S+) Canola$/i)?.[1] ?? null)
  const planned = destinationFromPlan(leavingFields.length ? plans?.get(leavingFields[0]) : null, company)
  // The haul plan's guess until someone picks: then theirs.
  const [picked, setDest] = useState<Destination | null>(null)
  const dest = picked ?? planned
  const kind = dest?.kind ?? 'site'
  const [newPlace, setNewPlace] = useState('')

  const [on, setOn] = useState(new Date().toLocaleDateString('en-CA'))
  const [ticket, setTicket] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const siteName = (id: string) => (sites ?? []).find((s) => s.id === id)?.name ?? null
  const valid = !!source && bushels != null && bushels > 0 && destinationReady(dest)
  const over = !all && source != null && bushels != null && bushels > source.bushels + ALL_OF_IT_BU

  const save = () => {
    if (!valid || !source || bushels == null || !dest) return
    setError(null)
    const rows = shipmentRows({
      binId: from.id,
      cropId: source.cropId,
      cropYear,
      bushels: Number(bushels.toFixed(2)),
      on,
      lots,
      destination: dest,
      ticket,
      note: note || `Shipped ${Math.round(bushels).toLocaleString()} bu from ${from.name}, ${destinationText(dest, siteName)}`,
    })
    ship.mutate(
      { rows, binId: from.id, cropYear, on, allOfIt, contentId: allOfIt ? (content?.id ?? null) : null },
      { onSuccess: onClose, onError: (e) => setError((e as Error).message) },
    )
  }

  return (
    <Modal title={`Ship out of ${from.name}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        {!source ? (
          <p className="rounded-md bg-gray-50 px-3 py-4 text-xs text-gray-500">{from.name} is empty, so there is nothing to ship.</p>
        ) : (
          <>
            {held.length > 1 && (
              <label className="block">
                <span className="text-xs text-gray-500">What is shipping</span>
                <Select
                  value={source.cropId}
                  ariaLabel="Crop to ship"
                  onChange={setCropId}
                  options={held.map((h) => ({ value: h.cropId, label: `${h.name} — ${Math.round(h.bushels).toLocaleString()} bu` }))}
                />
              </label>
            )}

            <div>
              <span className="text-xs text-gray-500">How much</span>
              <div className="mt-1 flex gap-1">
                <button type="button" className={pill(all)} onClick={() => setAll(true)}>
                  All of it · {Math.round(source.bushels).toLocaleString()} bu {source.name}
                </button>
                <button type="button" className={pill(!all)} onClick={() => setAll(false)}>
                  Some of it
                </button>
              </div>
              {!all && (
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <input type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" aria-label="Amount" className={cn(input, 'tabular-nums')} />
                  <Select value={unit} ariaLabel="Unit" onChange={(v) => setUnit(v as MassUnit)} options={MASS_UNITS.map((u) => ({ value: u.key, label: u.label }))} />
                </div>
              )}
              {over && (
                <p className="mt-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  That is more than the {Math.round(source.bushels).toLocaleString()} bu the records show in {from.name}; it will leave the bin negative.
                </p>
              )}
            </div>

            <div>
              <span className="text-xs text-gray-500">Where it went</span>
              <div className="mt-1 flex gap-1">
                <button type="button" className={pill(kind === 'site')} onClick={() => setDest({ kind: 'site', siteId: dest?.kind === 'site' ? dest.siteId : '' })}>
                  Hauled to a plant or elevator
                </button>
                <button type="button" className={pill(kind === 'pickup')} onClick={() => setDest({ kind: 'pickup', buyer: dest?.kind === 'pickup' ? dest.buyer : (company ?? '') })}>
                  Picked up at our yard
                </button>
              </div>
              {kind === 'site' ? (
                <div className="mt-1.5 space-y-1.5">
                  <Select
                    value={dest?.kind === 'site' ? dest.siteId : ''}
                    ariaLabel="Where it was hauled"
                    onChange={(id) => setDest({ kind: 'site', siteId: id })}
                    options={[{ value: '', label: 'Pick a place' }, ...(sites ?? []).map((s) => ({ value: s.id, label: s.name }))]}
                  />
                  <div className="flex gap-1.5">
                    <input value={newPlace} onChange={(e) => setNewPlace(e.target.value)} placeholder="Or add a place: the feedlot, an elevator…" aria-label="New place" className={input} />
                    <button
                      type="button"
                      disabled={!newPlace.trim() || addSite.isPending}
                      onClick={() =>
                        addSite.mutate(newPlace, {
                          onSuccess: (s) => {
                            setNewPlace('')
                            setDest({ kind: 'site', siteId: s.id })
                          },
                          onError: (e) => setError((e as Error).message),
                        })
                      }
                      className="shrink-0 rounded-md border border-gray-300 px-2.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </div>
              ) : (
                <input
                  value={dest?.kind === 'pickup' ? dest.buyer : ''}
                  onChange={(e) => setDest({ kind: 'pickup', buyer: e.target.value })}
                  placeholder="Who picked it up: BASF, Corteva…"
                  aria-label="Buyer who picked it up"
                  className={cn(input, 'mt-1.5')}
                />
              )}
              {planned && dest && JSON.stringify(planned) === JSON.stringify(dest) && (
                <p className="mt-1 text-[11px] text-gray-500">From the field&apos;s haul plan.</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-gray-500">Date</span>
                <input type="date" value={on} onChange={(e) => setOn(e.target.value)} className={input} />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Ticket # (if any)</span>
                <input value={ticket} onChange={(e) => setTicket(e.target.value)} className={input} />
              </label>
            </div>
            <label className="block">
              <span className="text-xs text-gray-500">Note</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} className={input} />
            </label>

            {bushels != null && bushels > 0 && dest && destinationReady(dest) && (
              <p className="flex items-center gap-1.5 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
                <Truck className="h-4 w-4 text-gray-400" />
                {Math.round(bushels).toLocaleString()} bu {source.name}, {destinationText(dest, siteName)}
                {allOfIt && <span className="ml-auto text-xs text-gray-500">{from.name} will be empty and its plan cleared</span>}
              </p>
            )}
          </>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!valid || ship.isPending}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {ship.isPending ? 'Saving…' : 'Ship out'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
