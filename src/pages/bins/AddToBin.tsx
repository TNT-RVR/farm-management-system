import { useMemo, useState } from 'react'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import { DateField } from '@/components/DateField'
import { useCrops } from '@/lib/queries'
import { useGrainMovementMutations } from '@/lib/inventory'
import { cropForVariety } from '@/lib/crop-variety-settings'
import { useCropVarietySettings } from '@/lib/crop-variety-settings-data'
import { binCropOptions, useBinContents } from '@/lib/bin-contents'
import { bushelWeightFor, convertMass, MASS_UNITS, type MassUnit } from '@/lib/bushels'
import { cn } from '@/lib/utils'

const box = 'mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none'
const numBox = cn(box, 'text-right tabular-nums')
const label = 'block text-xs text-gray-500'

/** Where it came from, which says what is asked for and how it is filed. */
type Reason = 'bought' | 'carryover' | 'correction'
const REASONS: { value: Reason; label: string; hint: string }[] = [
  { value: 'bought', label: 'Bought', hint: 'Seed, feed or fertilizer bought in. Say what it cost if you like.' },
  { value: 'carryover', label: 'Already in it', hint: 'Grown in an earlier year and never hauled out. Not counted as this year’s crop.' },
  { value: 'correction', label: 'Correction', hint: 'The figure is wrong. Put in the difference, minus to take some off.' },
]

/**
 * Putting something in a bin that did not come off a field (Sam, 26 Oct
 * 2026): bought seed, fertilizer, or wheat left over from an earlier year.
 *
 * Grain is counted in bushels, so a weight is converted at the crop's bushel
 * weight. Fertilizer is not a crop and is bought by the tonne, so it is filed
 * by name in tonnes and never added to the bushels — a bin's grain and its
 * fertilizer are two separate figures.
 */
export function AddToBin({
  binId,
  binName,
  cropYear,
  defaultCropId,
  onClose,
}: {
  binId: string
  binName: string
  cropYear: number
  defaultCropId?: string | null
  onClose: () => void
}) {
  const { data: crops } = useCrops()
  const { data: varietySettings } = useCropVarietySettings()
  const { data: contents } = useBinContents()
  const { create } = useGrainMovementMutations(cropYear)

  const [reason, setReason] = useState<Reason>('bought')
  const [isCrop, setIsCrop] = useState(true)
  const [cropId, setCropId] = useState(defaultCropId ?? '')
  const [product, setProduct] = useState('')
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState<MassUnit>('bu')
  const [grownIn, setGrownIn] = useState(String(cropYear - 1))
  const [movedAt, setMovedAt] = useState(new Date().toISOString().slice(0, 10))
  const [supplier, setSupplier] = useState('')
  const [cost, setCost] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const listed = (crops ?? []).find((c) => c.id === cropId)
  const binVariety = (contents ?? []).find((c) => c.bin_id === binId && c.crop_id === cropId)?.variety ?? null
  const crop = listed ? cropForVariety(listed, binVariety, varietySettings) : undefined
  const standard = crop ? bushelWeightFor(crop.name, crop.test_weight_lb_per_bu) : null
  const lbPerBu = standard?.lbPerBu ?? null
  // Grain is kept in bushels, so a weight has to be converted — and cannot be
  // without the crop's bushel weight (Crop settings).
  const bushels = useMemo(() => (isCrop ? convertMass(Number(amount), unit, 'bu', lbPerBu) : null), [isCrop, amount, unit, lbPerBu])
  const tonnes = !isCrop && amount.trim() !== '' ? Number(amount) : null
  const needsWeight = isCrop && unit !== 'bu' && lbPerBu == null

  const valid = isCrop
    ? !!cropId && bushels != null && (reason === 'correction' ? bushels !== 0 : bushels > 0)
    : product.trim() !== '' && tonnes != null && Number.isFinite(tonnes) && tonnes !== 0

  const save = async () => {
    if (!valid) return
    setBusy(true)
    setError(null)
    const year = reason === 'carryover' ? Number(grownIn) || cropYear : cropYear
    const what = isCrop ? (crop?.name ?? 'grain') : product.trim()
    try {
      await create.mutateAsync({
        crop_year: year,
        bin_id: binId,
        crop_id: isCrop ? cropId : null,
        product: isCrop ? null : product.trim(),
        movement_type: reason === 'bought' ? 'purchase_in' : reason === 'carryover' ? 'carryover_in' : 'adjustment',
        // A fertilizer is counted in tonnes; the bushel ledger is left at nil.
        bushels: isCrop ? Number(bushels!.toFixed(2)) : 0,
        tonnes: isCrop ? null : Number(tonnes!.toFixed(2)),
        moved_at: movedAt,
        supplier: reason === 'bought' && supplier.trim() ? supplier.trim() : null,
        cost: reason === 'bought' && cost.trim() !== '' && Number.isFinite(Number(cost)) ? Number(cost) : null,
        notes:
          notes.trim() ||
          (reason === 'bought'
            ? `Bought ${what}${supplier.trim() ? ` from ${supplier.trim()}` : ''}`
            : reason === 'carryover'
              ? `${what} left in the bin from ${year}`
              : `Correction to the ${what} figure`),
      })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pick = REASONS.find((r) => r.value === reason)!

  return (
    <Modal title={`Add to ${binName}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div>
          <span className={label}>Where did it come from?</span>
          <span className="mt-1 flex overflow-hidden rounded-md border border-gray-300 bg-white text-xs">
            {REASONS.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setReason(r.value)}
                className={cn('flex-1 px-2 py-2 leading-tight', reason === r.value ? 'bg-brand-700 font-semibold text-white' : 'text-gray-600 hover:bg-gray-50')}
              >
                {r.label}
              </button>
            ))}
          </span>
          <p className="mt-1 text-[11px] text-gray-500">{pick.hint}</p>
        </div>

        <div>
          <span className={label}>What is it?</span>
          <span className="mt-1 flex overflow-hidden rounded-md border border-gray-300 bg-white text-xs">
            <button type="button" onClick={() => setIsCrop(true)} className={cn('flex-1 px-2 py-2', isCrop ? 'bg-brand-700 font-semibold text-white' : 'text-gray-600 hover:bg-gray-50')}>
              A crop (bushels)
            </button>
            <button type="button" onClick={() => setIsCrop(false)} className={cn('flex-1 px-2 py-2', !isCrop ? 'bg-brand-700 font-semibold text-white' : 'text-gray-600 hover:bg-gray-50')}>
              Fertilizer or other (tonnes)
            </button>
          </span>
        </div>

        {isCrop ? (
          <label className="block">
            <span className={label}>Crop</span>
            <Select value={cropId} ariaLabel="Crop" className="mt-1" onChange={setCropId} options={[{ value: '', label: 'Pick a crop' }, ...binCropOptions(crops ?? [])]} />
          </label>
        ) : (
          <label className="block">
            <span className={label}>What it is</span>
            <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. 46-0-0 urea" className={box} />
          </label>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={label}>{isCrop ? 'Amount' : 'Tonnes'}</span>
            <input type="number" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={numBox} />
          </label>
          {isCrop ? (
            <label className="block">
              <span className={label}>Measured in</span>
              <Select value={unit} ariaLabel="Unit" className="mt-1" onChange={(v) => setUnit(v as MassUnit)} options={MASS_UNITS.map((u) => ({ value: u.key, label: u.label }))} />
            </label>
          ) : (
            <label className="block">
              <span className={label}>Measured in</span>
              <p className="mt-1 py-1.5 text-sm text-gray-600">tonnes</p>
            </label>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={label}>Date</span>
            <DateField value={movedAt} onChange={setMovedAt} className="mt-1 rounded-md bg-white" />
          </label>
          {reason === 'carryover' && (
            <label className="block">
              <span className={label}>Year it was grown</span>
              <input type="number" inputMode="numeric" value={grownIn} onChange={(e) => setGrownIn(e.target.value)} className={numBox} />
            </label>
          )}
        </div>

        {reason === 'bought' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={label}>Bought from</span>
              <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="optional" className={box} />
            </label>
            <label className="block">
              <span className={label}>What it cost ($)</span>
              <input type="number" step="0.01" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="optional" className={numBox} />
            </label>
          </div>
        )}

        <label className="block">
          <span className={label}>Note</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" className={box} />
        </label>

        <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
          {isCrop ? (
            needsWeight ? (
              <p className="text-xs text-amber-800">{crop?.name ?? 'This crop'} has no bushel weight set, so a weight cannot be turned into bushels. Put the amount in bushels, or set it on Crop settings.</p>
            ) : (
              <p className="text-sm">
                <b className="tabular-nums">{bushels == null ? '—' : `${Math.round(bushels).toLocaleString('en-CA')} bu`}</b>
                <span className="text-gray-500">{lbPerBu ? ` into ${binName} at ${lbPerBu} lb/bu` : ` into ${binName}`}</span>
              </p>
            )
          ) : (
            <p className="text-sm">
              <b className="tabular-nums">{tonnes == null ? '—' : `${tonnes.toLocaleString('en-CA')} t`}</b>
              <span className="text-gray-500"> of {product.trim() || 'it'} into {binName}. Counted on its own, never added to the bushels.</span>
            </p>
          )}
        </div>

        {error && <p className="text-xs text-red-700">{error}</p>}
        <div className="flex items-center gap-2">
          <button type="button" disabled={!valid || busy} onClick={() => void save()} className="rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40">
            {busy ? 'Saving…' : 'Add to the bin'}
          </button>
          <button type="button" onClick={onClose} className="px-2 text-xs text-gray-500 underline">
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
