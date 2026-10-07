import { Fragment, useMemo, useState } from 'react'
import { AlertTriangle, Package } from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import { useCropYear } from '@/lib/crop-year'
import { useRequirements } from '@/lib/requirements'
import { Link } from 'react-router-dom'
import { useManureWithTimes, useSoilByField } from '@/lib/fert-savings/data'
import { creditSpreadOver, farmTypical, type ManureApplication } from '@/lib/manure-credit'
import {
  microTotals,
  totalsByNutrient,
  totalsByProduct,
} from '@/lib/fertilizer-plan'

const n0 = (v: number | null) => (v == null ? '—' : Math.round(v).toLocaleString('en-CA'))
const n2 = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 2 }))
// Tonnes to one place: an order is placed in tenths of a tonne at best, and
// the second decimal was 2 kg of false precision on a truckload.
const n1 = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function Requirements() {
  const { cropYear } = useCropYear()
  const { requirements, isLoading } = useRequirements(cropYear)
  const [expanded, setExpanded] = useState<string | null>(null)

  const products = useMemo(() => totalsByProduct(requirements), [requirements])
  const nutrients = useMemo(() => totalsByNutrient(requirements), [requirements])
  const micros = useMemo(() => microTotals(requirements), [requirements])
  const awaiting = requirements.filter((r) => r.lines == null)
  // Fields whose recommendation was written before a manure spread it should
  // credit: these totals still include fertilizer the manure has covered.
  const { data: manure } = useManureWithTimes()
  const { data: soil } = useSoilByField(cropYear)
  const staleManure = useMemo(
    () =>
      requirements.filter((r) => {
        const apps = (manure ?? []).filter((m) => m.field_id === r.fieldId) as unknown as (ManureApplication & { created_at: string })[]
        const c = creditSpreadOver(apps, cropYear, r.acres, farmTypical((manure ?? []) as unknown as ManureApplication[]))
        if (c.n + c.p2o5 + c.k2o < 1) return false
        const newest = apps.map((a) => a.created_at).sort().pop()
        const at = soil?.get(r.fieldId)?.assessedAt
        return !!newest && (!at || newest > at)
      }),
    [requirements, manure, soil, cropYear],
  )
  const noAcres = requirements.filter((r) => r.lines != null && r.acres == null)

  if (isLoading) return <p className="py-16 text-center text-sm text-gray-400">Loading…</p>
  if (!requirements.length) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 py-16 text-center text-sm text-gray-400">
        No soil tests for {cropYear} yet, so there is nothing to total.
      </p>
    )
  }

  return (
    <div>
      {/* Anything the totals could not include is said out loud. A number that
          silently omits four fields is the number that gets ordered against. */}
      {staleManure.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" /> Manure these totals do not know about
          </p>
          <p className="mt-0.5">
            {staleManure.map((r) => r.fieldName).join(', ')} had manure recorded after the
            recommendation was written, so the fertilizer here still covers what the manure supplies.{' '}
            <Link to="/fertilizer?tab=Savings" className="font-medium underline">
              Rewrite them from Savings → Manure credits in the prescription
            </Link>
            .
          </p>
        </div>
      )}
      {(awaiting.length > 0 || noAcres.length > 0) && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" /> These totals are not the whole farm
          </p>
          {awaiting.length > 0 && (
            <p className="mt-1">
              <b>{awaiting.length}</b> field{awaiting.length === 1 ? '' : 's'} have no assessment yet
              and contribute nothing: {awaiting.map((r) => r.fieldName).join(', ')}.
            </p>
          )}
          {noAcres.length > 0 && (
            <p className="mt-1">
              <b>{noAcres.length}</b> field{noAcres.length === 1 ? '' : 's'} have a programme but no
              acreage, so their rates cannot be turned into a quantity:{' '}
              {noAcres.map((r) => r.fieldName).join(', ')}.
            </p>
          )}
        </div>
      )}

      {/* Product totals — the order sheet. */}
      <div className="mb-4 rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center gap-1.5 border-b border-gray-200 px-3 py-2">
          <Package className="h-4 w-4 text-brand-700" />
          <h3 className="text-sm font-semibold text-gray-900">Product needed across the farm · {cropYear}</h3>
        </div>
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 text-right font-medium" style={{ width: '14%' }}>Fields</th>
              <th className="px-3 py-2 text-right font-medium" style={{ width: '20%' }}>Total lb</th>
              <th className="px-3 py-2 text-right font-medium" style={{ width: '20%' }}>Tonnes</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.product} className="border-b border-gray-100 last:border-0">
                <td className="px-3 py-2 font-medium text-gray-900">
                  {p.product}
                  {(p.missingAcres.length > 0 || p.missingRate.length > 0) && (
                    // Its own line, not trailing the name — inline it reads as
                    // part of the product ("ammonium sulphate rate not…").
                    <span className="mt-0.5 block text-[11px] font-normal text-amber-700">
                      {p.missingRate.length > 0 &&
                        `rate not derivable for ${p.missingRate.join(', ')}`}
                      {p.missingRate.length > 0 && p.missingAcres.length > 0 && ' · '}
                      {p.missingAcres.length > 0 && `no acres for ${p.missingAcres.join(', ')}`}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{p.fields}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">{n0(p.totalLb)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">{n1(p.totalTonnes)}</td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-gray-400">Nothing to total yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Micronutrients, as actual nutrient. A 10% chelate and a 36% sulphate
          are not one order line, and adding their weights would produce a
          tonnage matching nothing you could buy. */}
      {micros.length > 0 && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Micronutrients — as actual nutrient
          </p>
          <div className="mt-1.5 space-y-1">
            {micros.map((m) => (
              <p key={m.nutrient} className="text-xs text-gray-600">
                {m.nutrient} <b className="tabular-nums text-gray-900">{n0(m.totalLb)} lb</b>
                <span className="text-gray-400">
                  {' '}
                  — quoted as {m.products.slice(0, 3).join(', ')}
                  {m.products.length > 3 ? ` and ${m.products.length - 3} more` : ''}
                </span>
              </p>
            ))}
          </div>
          <HelpNote className="mt-1" summary="Counted as nutrient, not product." title="Why micronutrients are totalled as nutrient">
            Totalled as nutrient rather than product because the concentrations differ — pick the
            form first, then convert. These pounds are also inside the nutrient totals below, which
            count every source including the blends, so the two figures differ where a micro arrives
            in a blended product.
          </HelpNote>
        </div>
      )}

      {/* Nutrient totals — how the agronomy is actually discussed. */}
      {nutrients.length > 0 && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Actual nutrient across the farm
          </p>
          <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
            {nutrients.map((x) => (
              <span key={x.nutrient} className="text-xs text-gray-600">
                {x.nutrient}{' '}
                <b className="tabular-nums text-gray-900">{n0(x.totalLb)} lb</b>
                <span className="text-gray-400"> over {x.fields} field{x.fields === 1 ? '' : 's'}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Per field. */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <p className="border-b border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900">By field</p>
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 font-medium">Field</th>
              <th className="px-3 py-2 font-medium" style={{ width: '18%' }}>Crop</th>
              <th className="px-3 py-2 text-right font-medium" style={{ width: '12%' }}>Acres</th>
              <th className="px-3 py-2 text-right font-medium" style={{ width: '14%' }}>Products</th>
            </tr>
          </thead>
          <tbody>
            {requirements.map((r) => (
              <Fragment key={r.fieldId}>
                <tr
                  onClick={() => setExpanded(expanded === r.fieldId ? null : r.fieldId)}
                  className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                >
                  <td className="px-3 py-2 font-medium text-gray-900">{r.fieldName}</td>
                  <td className="px-3 py-2 text-gray-600">{r.cropLabel ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                    {r.acres == null ? <span className="text-amber-700">not set</span> : n0(r.acres)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {r.lines == null ? (
                      <span className="text-gray-400">no assessment</span>
                    ) : (
                      r.lines.length
                    )}
                  </td>
                </tr>
                {expanded === r.fieldId && r.lines && (
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <td colSpan={4} className="px-3 py-2">
                      <table className="w-full table-fixed text-[11px]">
                        <thead>
                          <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
                            <th className="py-1 font-medium" style={{ width: '10%' }}>Nutrient</th>
                            <th className="py-1 font-medium" style={{ width: '22%' }}>Product</th>
                            <th className="py-1 text-right font-medium" style={{ width: '12%' }}>lb/ac actual</th>
                            <th className="py-1 text-right font-medium" style={{ width: '12%' }}>lb/ac product</th>
                            <th className="py-1 text-right font-medium" style={{ width: '14%' }}>lb for field</th>
                            <th className="py-1 font-medium">Timing</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.lines.map((l, i) => (
                            <tr key={i} className="border-t border-gray-200/70">
                              <td className="py-1 font-semibold text-gray-900">{l.nutrient}</td>
                              <td className="py-1 text-gray-700">{l.product}</td>
                              <td className="py-1 text-right tabular-nums">{n2(l.lbPerAc)}</td>
                              <td className="py-1 text-right tabular-nums text-gray-600">
                                {l.productLbPerAc == null ? (
                                  <span className="text-amber-700" title="No analysis in the product name to derive it from">
                                    n/a
                                  </span>
                                ) : (
                                  n2(l.productLbPerAc)
                                )}
                              </td>
                              <td className="py-1 text-right font-medium tabular-nums text-gray-900">
                                {n0(l.productLbTotal)}
                              </td>
                              <td className="py-1 text-gray-500">{l.timing ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <HelpNote className="mt-2" summary="Each field's programme × its acres. Check rates before ordering." title="How the quantities are worked out">
        Quantities come from each field&rsquo;s generated programme multiplied by its acres. Acres
        follow the crop plan where one exists, and the drawn boundary otherwise — a boundary can
        include headland a pivot never covers. Product weight is derived from the analysis in the
        product name (46-0-0 urea at 46% N). Products are grouped by that analysis rather than by
        the words around it, because the same product gets written a dozen ways — grouping on the
        text split potash across four rows. Anything without an analysis is counted as actual
        nutrient instead. Check rates before ordering.
      </HelpNote>
    </div>
  )
}
