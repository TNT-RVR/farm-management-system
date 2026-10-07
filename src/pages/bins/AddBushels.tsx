import { binCropOptions } from '@/lib/bin-contents'
import { useMemo, useState } from 'react'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import { useCrops } from '@/lib/queries'
import { useGrainMovementMutations, GRAIN_MOVEMENT_TYPES } from '@/lib/inventory'
import { bushelWeightFor, convertMass, MASS_UNITS, type MassUnit } from '@/lib/bushels'

const numInput =
  'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-brand-600 focus:outline-none'

/**
 * Putting grain into a bin, in whatever unit it was measured.
 *
 * Bins are counted in bushels and trucks are weighed in tonnes, so the number
 * on the scale ticket is almost never the number the bin wants. Doing that
 * arithmetic on a phone at the pit is where mistakes come from, and a mistake
 * here is a bin that reads full when it is not.
 *
 * The movement is what is actually recorded — on-hand is a view over
 * grain_movements, so there is nothing to "set", only history to add to. That
 * is the right shape: it means a bin's contents can always be explained.
 */
export function AddBushels({
  binId,
  binName,
  cropYear,
  defaultCropId,
  onClose,
}: {
  binId: string
  binName: string
  cropYear: number
  /** The crop already allocated to this bin, where there is one. */
  defaultCropId?: string | null
  onClose: () => void
}) {
  const { data: crops } = useCrops()
  const { create } = useGrainMovementMutations(cropYear)

  const [cropId, setCropId] = useState(defaultCropId ?? '')
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState<MassUnit>('bu')
  const [movementType, setMovementType] =
    useState<(typeof GRAIN_MOVEMENT_TYPES)[number]['value']>('harvest_in')
  const [movedAt, setMovedAt] = useState(new Date().toISOString().slice(0, 10))
  const [ticket, setTicket] = useState('')
  const [notes, setNotes] = useState('')
  const [override, setOverride] = useState('')

  const crop = (crops ?? []).find((c) => c.id === cropId)
  const standard = crop ? bushelWeightFor(crop.name, crop.test_weight_lb_per_bu) : null
  const typed = Number(override)
  const lbPerBu =
    override.trim() !== '' && Number.isFinite(typed) && typed > 0
      ? typed
      : (standard?.lbPerBu ?? null)

  // Everything is stored in bushels, so a weight has to be converted before it
  // can be filed — and cannot be, without knowing the crop.
  const bushels = useMemo(
    () => convertMass(Number(amount), unit, 'bu', lbPerBu),
    [amount, unit, lbPerBu],
  )

  const weighed = unit !== 'bu'
  const blocked = weighed && lbPerBu == null
  const valid = cropId !== '' && bushels != null && bushels > 0

  return (
    <Modal title={`Add grain to ${binName}`} onClose={onClose}>
      <div className="space-y-2.5 text-sm">
        <label className="block">
          <span className="text-xs text-gray-500">Crop</span>
          <Select
            value={cropId}
            ariaLabel="Crop"
            onChange={setCropId}
            options={[
              { value: '', label: 'Pick a crop' },
              ...binCropOptions(crops ?? []),
            ]}
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-gray-500">Amount</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={numInput}
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Measured in</span>
            <Select
              value={unit}
              ariaLabel="Unit"
              onChange={(v) => setUnit(v as MassUnit)}
              options={MASS_UNITS.map((u) => ({ value: u.key, label: u.label }))}
            />
          </label>
        </div>

        {/* Only when it matters. A figure already in bushels needs no test
            weight, and showing the box anyway invites somebody to fill it in. */}
        {weighed && (
          <label className="block">
            <span className="text-xs text-gray-500">
              Test weight (lb/bu)
              {standard && <span className="text-gray-400"> · standard {standard.lbPerBu}</span>}
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              placeholder={standard ? String(standard.lbPerBu) : '—'}
              className={numInput}
            />
          </label>
        )}

        {weighed && (
          <p
            className={
              blocked
                ? 'rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900'
                : 'rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700'
            }
          >
            {blocked ? (
              cropId === '' ? (
                'Pick a crop — a bushel is a different weight for every one, so a weight cannot be turned into bushels without it.'
              ) : (
                `${crop?.name} is not sold by the bushel and has no standard test weight. Type one above, or enter the amount in bushels.`
              )
            ) : (
              <>
                Goes in as{' '}
                <span className="font-semibold tabular-nums">
                  {bushels?.toLocaleString('en-CA', { maximumFractionDigits: 1 })} bu
                </span>
                <span className="text-gray-500"> at {lbPerBu} lb/bu</span>
              </>
            )}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-gray-500">Movement</span>
            <Select
              value={movementType}
              ariaLabel="Movement type"
              onChange={(v) =>
                setMovementType(v as (typeof GRAIN_MOVEMENT_TYPES)[number]['value'])
              }
              options={GRAIN_MOVEMENT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Date</span>
            <input
              type="date"
              value={movedAt}
              onChange={(e) => setMovedAt(e.target.value)}
              className={numInput}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-gray-500">Ticket number</span>
            <input
              value={ticket}
              onChange={(e) => setTicket(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Note</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        {create.isError && (
          <p className="text-xs text-red-600">{(create.error as Error).message}</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            disabled={!valid || create.isPending}
            onClick={() =>
              create.mutate(
                {
                  crop_year: cropYear,
                  bin_id: binId,
                  crop_id: cropId,
                  movement_type: movementType,
                  // Always stored in bushels, whatever it was typed in.
                  bushels: Number((bushels as number).toFixed(2)),
                  moved_at: movedAt,
                  ticket_number: ticket.trim() || null,
                  notes:
                    notes.trim() ||
                    (weighed
                      ? `Entered as ${amount} ${unit} at ${lbPerBu} lb/bu`
                      : null),
                },
                { onSuccess: onClose },
              )
            }
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {create.isPending ? 'Saving…' : 'Add to bin'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
