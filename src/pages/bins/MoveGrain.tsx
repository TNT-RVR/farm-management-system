import { useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import { useCrops } from '@/lib/queries'
import { useGrainMovementMutations } from '@/lib/inventory'
import { useBinOnHand, type BinRow } from '@/lib/bins'
import { bushelWeightFor, convertMass, MASS_UNITS, type MassUnit } from '@/lib/bushels'

const numInput =
  'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-brand-600 focus:outline-none'

/**
 * Moving grain from one bin to another.
 *
 * Recorded as TWO movements — out of the source, into the destination — because
 * that is what actually happened and because on-hand is a view over the
 * movement history. A single "transfer" row would leave both bins right and the
 * history unable to explain either of them.
 *
 * The two are written together and the destination first. If the second insert
 * failed after the first succeeded, grain would vanish: better to have it
 * briefly in both places than briefly in neither, and the failure is reported
 * either way.
 */
export function MoveGrain({
  bins,
  cropYear,
  from,
  onClose,
}: {
  bins: BinRow[]
  cropYear: number
  /** The bin the move was started from. */
  from: BinRow
  onClose: () => void
}) {
  const { data: crops } = useCrops()
  const { data: onHand } = useBinOnHand()
  const { create } = useGrainMovementMutations(cropYear)

  // What is actually in the source bin, by crop. You cannot move out what is
  // not there, so the crop list here is the bin's contents rather than every
  // crop on the farm.
  const held = useMemo(
    () =>
      (onHand ?? [])
        .filter((o) => o.bin_id === from.id && o.onhand_bu > 0)
        .map((o) => ({
          cropId: o.crop_id,
          bushels: o.onhand_bu,
          name: (crops ?? []).find((c) => c.id === o.crop_id)?.name ?? 'Unknown crop',
        })),
    [onHand, from.id, crops],
  )

  const [cropId, setCropId] = useState(held[0]?.cropId ?? '')
  const [toBinId, setToBinId] = useState('')
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState<MassUnit>('bu')
  const [movedAt, setMovedAt] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const source = held.find((h) => h.cropId === cropId)
  const crop = (crops ?? []).find((c) => c.id === cropId)
  const standard = crop ? bushelWeightFor(crop.name, crop.test_weight_lb_per_bu) : null
  const lbPerBu = standard?.lbPerBu ?? null

  const bushels = convertMass(Number(amount), unit, 'bu', lbPerBu)
  const toBin = bins.find((b) => b.id === toBinId)
  const over = bushels != null && source != null && bushels > source.bushels

  const valid =
    cropId !== '' && toBinId !== '' && toBinId !== from.id && bushels != null && bushels > 0

  const move = async () => {
    if (!valid || bushels == null) return
    setBusy(true)
    setError(null)
    const rounded = Number(bushels.toFixed(2))
    const note =
      notes.trim() ||
      `Moved ${rounded} bu from ${from.name} to ${toBin?.name ?? 'another bin'}`
    try {
      await create.mutateAsync({
        crop_year: cropYear,
        bin_id: toBinId,
        crop_id: cropId,
        movement_type: 'transfer_in',
        bushels: rounded,
        moved_at: movedAt,
        notes: note,
      })
      await create.mutateAsync({
        crop_year: cropYear,
        bin_id: from.id,
        crop_id: cropId,
        movement_type: 'transfer_out',
        bushels: rounded,
        moved_at: movedAt,
        notes: note,
      })
      onClose()
    } catch (e) {
      setError(
        `${(e as Error).message}. Check both bins — one side of the move may have been recorded.`,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Move grain out of ${from.name}`} onClose={onClose}>
      <div className="space-y-2.5 text-sm">
        {held.length === 0 ? (
          <p className="rounded-md bg-gray-50 px-3 py-4 text-xs text-gray-500">
            {from.name} is empty, so there is nothing to move out of it.
          </p>
        ) : (
          <>
            <label className="block">
              <span className="text-xs text-gray-500">What is in there</span>
              <Select
                value={cropId}
                ariaLabel="Crop to move"
                onChange={setCropId}
                options={held.map((h) => ({
                  value: h.cropId ?? '',
                  label: `${h.name} — ${Math.round(h.bushels).toLocaleString()} bu`,
                }))}
              />
            </label>

            <label className="block">
              <span className="text-xs text-gray-500">Into which bin</span>
              <Select
                value={toBinId}
                ariaLabel="Destination bin"
                onChange={setToBinId}
                options={[
                  { value: '', label: 'Pick a bin' },
                  ...bins
                    .filter((b) => b.id !== from.id && b.active)
                    .map((b) => ({
                      value: b.id,
                      label: `${b.name} — ${Math.round(b.capacity_bu).toLocaleString()} bu capacity`,
                    })),
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

            {source && (
              <button
                type="button"
                onClick={() => {
                  setAmount(String(Math.round(source.bushels * 100) / 100))
                  setUnit('bu')
                }}
                className="text-[11px] text-brand-700 underline hover:text-brand-800"
              >
                Move all {Math.round(source.bushels).toLocaleString()} bu
              </button>
            )}

            {/* A warning, not a block. Bins get emptied by eye and the records
                catch up afterwards; refusing the entry would just mean the move
                never gets recorded at all. */}
            {over && source && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                That is more than the {Math.round(source.bushels).toLocaleString()} bu the records
                show in {from.name}. Recording it will leave the bin negative.
              </p>
            )}

            {bushels != null && toBin && (
              <p className="flex items-center gap-1.5 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
                <span className="font-medium">{from.name}</span>
                <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
                <span className="font-medium">{toBin.name}</span>
                <span className="ml-auto tabular-nums">
                  {bushels.toLocaleString('en-CA', { maximumFractionDigits: 1 })} bu
                </span>
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-gray-500">Date</span>
                <input
                  type="date"
                  value={movedAt}
                  onChange={(e) => setMovedAt(e.target.value)}
                  className={numInput}
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
          </>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          {held.length > 0 && (
            <button
              disabled={!valid || busy}
              onClick={move}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? 'Moving…' : 'Move grain'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
