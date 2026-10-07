import type React from 'react'
import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Minus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ColumnHelp } from '@/components/ColumnHelp'
import { PLANNED_VS_ACTUAL_HELP } from '@/lib/column-help'
import { appliedByProduct, fmtMoney } from '@/lib/applied'
import { compareCrop, prettyCrop, type CropVerdict } from '@/lib/cropMatch'
import { useSeasonOperations } from '@/lib/fieldOps'
import { useProductResolver } from '@/lib/products'
import { useAllBoundaries, useCropInputs, useCropPlans, useCrops, useFields } from '@/lib/queries'
import { cn } from '@/lib/utils'

const VERDICT: Record<CropVerdict, { icon: typeof Check; className: string; label: string }> = {
  match: { icon: Check, className: 'text-green-600', label: 'Matches the plan' },
  mismatch: { icon: AlertTriangle, className: 'text-amber-600', label: 'Differs from the plan' },
  unknown: { icon: Minus, className: 'text-gray-300', label: 'Not enough to compare' },
}

/**
 * The plan against what the machines actually did.
 *
 * Both halves are only as good as their source: a field with no synced work
 * shows blanks rather than zeroes, because "no operations recorded" and "nothing
 * was applied" are different claims and only the first one is supported.
 */
export function PlannedVsActual({ cropYear }: { cropYear: number }) {
  const { data: fields } = useFields()
  const { data: boundaries } = useAllBoundaries()
  const { data: crops } = useCrops()
  const { data: plans } = useCropPlans(cropYear)
  const { data: inputs } = useCropInputs(cropYear)
  const { data: ops } = useSeasonOperations(cropYear)
  const resolve = useProductResolver()
  // Pass count and coverage are for chasing a variance down, not for reading
  // the table, so they wait behind a toggle.
  const [showWork, setShowWork] = useState(false)

  const cropNames = useMemo(() => (crops ?? []).map((c) => c.name), [crops])

  // Budgeted input cost per acre, by crop.
  const plannedCostByCrop = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of inputs ?? []) {
      if (i.cost_per_acre == null) continue
      m.set(i.crop_id, (m.get(i.crop_id) ?? 0) + Number(i.cost_per_acre))
    }
    return m
  }, [inputs])

  const rows = useMemo(() => {
    if (!fields || !plans || !ops) return []
    const cropById = new Map((crops ?? []).map((c) => [c.id, c]))
    const acresByField = new Map(
      (boundaries ?? []).filter((b) => b.acres != null).map((b) => [b.field_id, Number(b.acres)]),
    )
    const opsByField = new Map<string, typeof ops>()
    for (const o of ops) {
      if (!o.field_id) continue
      const list = opsByField.get(o.field_id) ?? []
      list.push(o)
      opsByField.set(o.field_id, list)
    }

    return plans
      .map((plan) => {
        const field = fields.find((f) => f.id === plan.field_id)
        if (!field) return null
        const crop = plan.crop_id ? cropById.get(plan.crop_id) : null
        const fieldOps = opsByField.get(plan.field_id) ?? []
        const acres = acresByField.get(plan.field_id) ?? null

        // Deere's crop for the field: whatever its operations agree on.
        const deereCrops = [...new Set(fieldOps.map((o) => o.treated_crop).filter(Boolean))]
        const deereCrop = deereCrops.length === 1 ? deereCrops[0]! : null

        const applications = fieldOps.filter((o) => o.operation_type === 'application')
        const actual =
          acres != null && applications.length > 0
            ? appliedByProduct(applications, acres, resolve)
            : null
        const actualPerAc = actual && acres ? actual.costed / acres : null

        const plannedPerAc = crop ? (plannedCostByCrop.get(crop.id) ?? null) : null

        // As-applied: what the machine measured itself putting out. Divided by
        // the FIELD's acres, not the ground covered — that is what makes it
        // comparable to a budget written per field acre. Several passes over one
        // field sum past its own acreage, so the covered figure is a coverage
        // diagnostic and never a cost denominator.
        const measuredPerAc =
          actual && actual.measuredUncosted === 0 && actual.measuredCosted > 0 && acres
            ? actual.measuredCosted / acres
            : null
        // Average coverage per pass: three passes at 38%, 39% and 80% is "about
        // half the field each time", not "156% covered".
        const coverage =
          actual?.appliedAcres != null && actual.passesWithArea > 0 && acres
            ? actual.appliedAcres / (acres * actual.passesWithArea)
            : null

        return {
          field,
          plannedCrop: crop?.name ?? null,
          deereCrop,
          deereCropsAmbiguous: deereCrops.length > 1,
          verdict: compareCrop(deereCrop, crop?.name, cropNames),
          passes: fieldOps.length,
          applications: applications.length,
          plannedPerAc,
          // Only meaningful once products carry prices — an unpriced field would
          // otherwise look like it came in miraculously under budget.
          actualPerAc: actual && actual.uncosted === 0 ? actualPerAc : null,
          partiallyPriced: Boolean(actual && actual.uncosted > 0 && actual.costed > 0),
          measuredPerAc,
          coverage,
          // Material went out but the machine reported no ground covered, so the
          // cost is known and the coverage is not.
          passesWithMaterialNoArea: actual?.passesWithMaterialNoArea ?? 0,
          // Passes that reported no as-applied figures, so the measured column
          // covers only part of the season's work on this field.
          passesWithoutMeasured: actual?.passesWithoutMeasured ?? 0,
          acres,
        }
      })
      .filter((r): r is NonNullable<typeof r> => r != null)
      .sort((a, b) => {
        // Anything worth looking at, first.
        const rank = (v: CropVerdict) => (v === 'mismatch' ? 0 : v === 'unknown' ? 2 : 1)
        return rank(a.verdict) - rank(b.verdict) || a.field.name.localeCompare(b.field.name)
      })
  }, [fields, plans, ops, crops, boundaries, resolve, plannedCostByCrop, cropNames])

  if (!ops) return <p className="text-sm text-gray-500">Loading…</p>
  if (ops.length === 0) {
    return (
      <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
        No John Deere field work synced for {cropYear} yet.
      </p>
    )
  }

  const mismatches = rows.filter((r) => r.verdict === 'mismatch').length
  const noWork = rows.filter((r) => r.passes === 0).length

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-sm">
        <span className={cn(mismatches > 0 ? 'font-medium text-amber-700' : 'text-gray-500')}>
          {mismatches} crop {mismatches === 1 ? 'difference' : 'differences'}
        </span>
        <span className="text-gray-500">{noWork} planned fields with no recorded work</span>
        <button
          type="button"
          onClick={() => setShowWork((s) => !s)}
          className="ml-auto text-xs text-brand-700 hover:underline"
        >
          {showWork ? 'Hide passes and coverage' : 'Show passes and coverage'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <Th help="field">Field</Th>
              <Th help="planned">Planned</Th>
              <Th help="reported">Deere reports</Th>
              {showWork && (
                <Th help="passes" right>
                  Passes
                </Th>
              )}
              {showWork && (
                <Th help="covered" right>
                  Covered
                </Th>
              )}
              <Th help="budget" right>
                Budget $/ac
              </Th>
              <Th help="actual" right>
                Actual $/ac
              </Th>
              <Th help="asApplied" right>
                As-applied $/ac
              </Th>
              <Th help="variance" right>
                Variance
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => {
              const v = VERDICT[r.verdict]
              // Measured beats derived: if the machine says what it put out,
              // that is the number the budget should be judged against.
              const against = r.measuredPerAc ?? r.actualPerAc
              const variance = r.plannedPerAc != null && against != null ? against - r.plannedPerAc : null
              return (
                <tr key={r.field.id} className={cn(r.verdict === 'mismatch' && 'bg-amber-50/50')}>
                  <td className="px-3 py-2">
                    {/* Straight to the full pass-by-pass history — that is what
                        someone clicking a row on this table is asking for. */}
                    <Link
                      to={`/fields/${r.field.id}/work`}
                      className="font-medium text-gray-800 hover:text-brand-700 hover:underline"
                    >
                      {r.field.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{r.plannedCrop ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <v.icon className={cn('h-3.5 w-3.5 shrink-0', v.className)} />
                      <span className="text-gray-600">
                        {r.deereCropsAmbiguous
                          ? 'several crops'
                          : r.deereCrop
                            ? prettyCrop(r.deereCrop)
                            : '—'}
                      </span>
                    </span>
                  </td>
                  {showWork && (
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.passes ? (
                      <Link
                        to={`/fields/${r.field.id}/work`}
                        className="text-gray-600 hover:text-brand-700 hover:underline"
                      >
                        {r.passes}
                      </Link>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  )}
                  {showWork && (
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {r.coverage == null ? (
                      <span className="text-gray-300">—</span>
                    ) : (
                      <span
                        title="Average share of the field each pass covered"
                        className={cn(
                          // Well under the whole field usually means a partial
                          // pass, not a saving. Worth a second look either way.
                          r.coverage < 0.8 ? 'text-amber-700' : '',
                        )}
                      >
                        {Math.round(r.coverage * 100)}%
                        {r.passesWithMaterialNoArea > 0 && <span className="text-amber-600">*</span>}
                      </span>
                    )}
                  </td>
                  )}
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {r.plannedPerAc != null ? fmtMoney(r.plannedPerAc) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {r.actualPerAc != null ? (
                      fmtMoney(r.actualPerAc)
                    ) : r.partiallyPriced ? (
                      <span className="text-xs text-gray-400">part priced</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.measuredPerAc != null ? (
                      <span
                        className="font-medium text-gray-800"
                        title={
                          r.passesWithoutMeasured > 0
                            ? `${r.passesWithoutMeasured} pass(es) reported no as-applied figures`
                            : "Measured by the machine, over the field's acres"
                        }
                      >
                        {fmtMoney(r.measuredPerAc)}
                        {r.passesWithoutMeasured > 0 && <span className="text-amber-600">*</span>}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right tabular-nums',
                      variance == null
                        ? 'text-gray-300'
                        : variance > 0
                          ? 'text-red-600'
                          : 'text-green-700',
                    )}
                  >
                    {variance == null
                      ? '—'
                      : `${variance > 0 ? '+' : ''}${fmtMoney(variance)}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** A header cell with its "what is this column?" button. */
function Th({
  help,
  right = false,
  children,
}: {
  help: keyof typeof PLANNED_VS_ACTUAL_HELP
  right?: boolean
  children: React.ReactNode
}) {
  return (
    <th className={cn('px-3 py-2 font-medium', right && 'text-right')}>
      <span className={cn('inline-flex items-center gap-1', right && 'justify-end')}>
        {children}
        <ColumnHelp help={PLANNED_VS_ACTUAL_HELP[help]} width={320} />
      </span>
    </th>
  )
}
