import { useMemo, useState } from 'react'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { Droplets, FlaskConical } from 'lucide-react'
import { AppliedProductDetail } from '@/components/AppliedProductDetail'
import { appliedByProduct, fmtMoney, fmtQty } from '@/lib/applied'
import { useFieldOperations } from '@/lib/fieldOps'
import { useProductResolver } from '@/lib/products'
import { useCropYear } from '@/lib/crop-year'

/**
 * What went on this field and what it cost.
 *
 * Rates come off the machine as per-acre figures, so every total here is
 * rate x acres — which makes the acreage load-bearing. Without a boundary the
 * card shows nothing rather than a total computed against a guess.
 */
export function FieldInputsCard({ fieldId, acres }: { fieldId: string; acres: number | null }) {
  const { data: ops } = useFieldOperations(fieldId)
  const resolve = useProductResolver()
  // Follows the year chosen at the top of the app rather than carrying its own
  // selector. Two year pickers on one page disagree with each other sooner or
  // later, and then the costs shown belong to a different season than the work
  // listed underneath them.
  const { cropYear } = useCropYear()
  const [openProduct, setOpenProduct] = useState<string | null>(null)

  const applications = useMemo(
    () =>
      (ops ?? []).filter(
        (o) => o.operation_type === 'application' && o.crop_season === cropYear,
      ),
    [ops, cropYear],
  )

  const { lines, waterL, costed, uncosted } = useMemo(
    () => appliedByProduct(applications, acres ?? 0, resolve),
    [applications, acres, resolve],
  )

  const openLine = lines.find((l) => l.product === openProduct) ?? null

  if (!ops || applications.length === 0) return null

  if (acres == null || acres <= 0) {
    return (
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
          <FlaskConical className="h-4 w-4" /> Inputs applied
        </h3>
        <p className="mt-1 text-xs text-amber-800">
          {applications.length} application{applications.length === 1 ? '' : 's'} recorded, but this
          field has no boundary acreage. Rates are per acre, so totals need the acres before they
          mean anything.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <FlaskConical className="h-4 w-4 text-brand-700" /> Inputs applied
        </h3>
        <span className="ml-auto text-xs text-gray-400">{cropYear}</span>
      </div>
      <p className="mt-0.5 text-xs text-gray-500">
        {applications.length} application{applications.length === 1 ? '' : 's'} in {cropYear} over{' '}
        {acres.toFixed(1)} ac. Deere records gallons as US. Tap a product for the passes behind it.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
              <th className="pb-1 font-medium">Product</th>
              <th className="pb-1 text-right font-medium">Passes</th>
              <th className="pb-1 text-right font-medium">Total</th>
              <th className="pb-1 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lines.map((l) => (
              <tr
                key={l.product}
                onClick={() => setOpenProduct(l.product)}
                title={`${l.passes} pass${l.passes === 1 ? '' : 'es'} — dates, rates, machine and operator`}
                className="cursor-pointer hover:bg-gray-50"
              >
                <td className="py-1.5 pr-2">
                  <span className="text-gray-800">{l.product}</span>
                  {/* Show the folding, so a merged line is never a mystery. */}
                  {l.aliases.length > 1 && (
                    <span className="ml-1.5 text-xs text-gray-400">
                      ({l.aliases.join(', ')})
                    </span>
                  )}
                  {l.unknownUnits.length > 0 && (
                    <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] text-amber-800">
                      unknown unit {l.unknownUnits.join(', ')}
                    </span>
                  )}
                </td>
                <td className="py-1.5 text-right tabular-nums text-gray-500">{l.passes}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-700">
                  {fmtQty(l.total, l.unit)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-gray-700">
                  {l.cost == null ? <span className="text-gray-300">—</span> : fmtMoney(l.cost)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 font-medium">
              <td className="pt-2" colSpan={3}>
                Total{uncosted > 0 && <span className="text-gray-400"> (priced products only)</span>}
              </td>
              <td className="pt-2 text-right tabular-nums">{fmtMoney(costed)}</td>
            </tr>
            {costed > 0 && (
              <tr className="text-xs text-gray-500">
                <td colSpan={3}>Per acre</td>
                <td className="text-right tabular-nums">{fmtMoney(costed / acres)}/ac</td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
        <Droplets className="h-3.5 w-3.5 text-sky-600" />
        {Math.round(waterL).toLocaleString('en-CA')} L of water carried
      </p>

      {openLine && (
        <AppliedProductDetail line={openLine} acres={acres} onClose={() => setOpenProduct(null)} />
      )}

      {uncosted > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          {uncosted} product{uncosted === 1 ? ' has' : 's have'} no price yet.{' '}
          <SetupLink managerOnly to={SETUP_LINKS.chemicalPrices()}>
            Set prices
          </SetupLink>
        </p>
      )}
    </div>
  )
}
