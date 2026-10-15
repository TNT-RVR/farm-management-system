import { useMemo, useState } from 'react'
import { Wheat } from 'lucide-react'
import { Select } from '@/components/Select'
import { useCrops } from '@/lib/queries'
import {
  allUnits,
  bushelWeightFor,
  digitsFor,
  MASS_UNITS,
  type MassUnit,
} from '@/lib/bushels'

const numInput =
  'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-brand-600 focus:outline-none'

/**
 * Bushels to weight, and back.
 *
 * Kept apart from the plain weight converter because a bushel is not a weight
 * until you say what the crop is — sixty pounds of wheat, fifty of canola,
 * thirty-four of oats. Putting bushels in the general converter would have made
 * it look like a fixed unit, which is exactly the mistake this prevents.
 *
 * Every unit is shown at once rather than a from/to pair. The question is
 * almost always "the bin holds 3,000 bushels, what is that in tonnes for the
 * contract, and pounds for the scale ticket" — one answer at a time turns that
 * into three passes.
 */
export function BushelCalculator() {
  const { data: crops } = useCrops()
  const [cropId, setCropId] = useState('')
  const [amount, setAmount] = useState('1000')
  const [from, setFrom] = useState<MassUnit>('bu')
  /** Blank means "use the crop's". Typed means this load, on this scale. */
  const [override, setOverride] = useState('')

  const bushelCrops = useMemo(
    () =>
      (crops ?? [])
        .filter((c) => c.active && bushelWeightFor(c.name, c.test_weight_lb_per_bu) != null)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [crops],
  )

  const crop = bushelCrops.find((c) => c.id === cropId)
  const standard = crop ? bushelWeightFor(crop.name, crop.test_weight_lb_per_bu) : null

  const typed = Number(override)
  const lbPerBu =
    override.trim() !== '' && Number.isFinite(typed) && typed > 0
      ? typed
      : (standard?.lbPerBu ?? null)

  const rows = allUnits(Number(amount), from, lbPerBu)
  const needsCrop = lbPerBu == null

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <Wheat className="h-4 w-4 text-brand-700" /> Bushels &amp; weight
      </h2>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr]">
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">Amount</label>
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={numInput}
          />
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">Measured in</label>
          <Select
            value={from}
            ariaLabel="Unit of the amount"
            onChange={(v) => setFrom(v as MassUnit)}
            options={MASS_UNITS.map((u) => ({ value: u.key, label: u.label }))}
          />
        </div>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr]">
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">Crop</label>
          <Select
            value={cropId}
            ariaLabel="Crop"
            onChange={setCropId}
            options={[
              { value: '', label: 'Not set — weights only' },
              ...bushelCrops.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">
            Test weight (lb/bu)
            {standard && <span className="text-gray-400"> · standard {standard.lbPerBu}</span>}
          </label>
          <input
            type="number"
            inputMode="decimal"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            placeholder={standard ? String(standard.lbPerBu) : '—'}
            className={numInput}
          />
        </div>
      </div>

      {needsCrop ? (
        <p className="mt-3 rounded-md bg-gray-50 px-3 py-3 text-xs text-gray-500">
          Pick a crop to work in bushels. A bushel is a different weight for every crop, so there is
          no honest answer without one — the weight units below still convert between themselves.
        </p>
      ) : null}

      <table className="mt-3 w-full text-sm">
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.unit} className={r.unit === from ? 'text-gray-400' : ''}>
              <td className="py-1.5 pr-3 text-xs text-gray-500">{r.label}</td>
              <td className="py-1.5 text-right font-medium tabular-nums">
                {r.value == null ? (
                  <span className="font-normal text-gray-300">—</span>
                ) : (
                  r.value.toLocaleString('en-CA', {
                    minimumFractionDigits: digitsFor(r.unit),
                    maximumFractionDigits: digitsFor(r.unit),
                  })
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-2 text-[11px] text-gray-500">
        {standard?.source === 'crop'
          ? `${crop?.name} is set to ${standard.lbPerBu} lb/bu on its crop record.`
          : standard
            ? `Using the trade standard for ${standard.label}. Type over it for the load on the scale.`
            : 'Metric tonnes and short tons differ by about 10% — both are listed.'}
      </p>
    </section>
  )
}
