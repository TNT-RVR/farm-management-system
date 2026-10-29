import { Link, useSearchParams } from 'react-router-dom'
import { useTab } from '@/lib/useTab'
import { BreakevenTab } from '@/pages/marketing/BreakevenTab'
import { cropColour } from '@/lib/crop-colour'
import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Lock, LockOpen, Printer } from 'lucide-react'
import { DataTable, type DataTableColumn } from '@/components/DataTable'
import { PillTabs } from '@/components/PillTabs'
import { Select } from '@/components/Select'
import { PromptDialog } from '@/components/Modal'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { usePartnerAccess } from '@/lib/partner-view'
import { useCropYear } from '@/lib/crop-year'
import { supabase } from '@/lib/supabase'
import { useCropVarietyMutations, useYearUnlocks, type CropVarietyRow } from '@/lib/queries'
import { ActualsTab } from '@/components/ActualsTab'
import { QbAskBar } from '@/components/QbAskBar'
import { FarmCostsTab } from '@/pages/plan/FarmCostsTab'
import { PlannedVsActual } from '@/components/PlannedVsActual'
import { money, money2, type PlanRowView } from '@/lib/planner'
import { useCropZoneMutations } from '@/lib/cropZones'
import { rentedOutIncome } from '@/lib/land-deals'
import { withDisplay } from '@/lib/reports/columns'
import { budgetExportColumns, planExportColumns, usePlanRows } from '@/lib/reports/plan'
import { cutLabel, formatYieldRange, isRange, parseYieldText, planYieldText } from '@/lib/yield-estimate'
import { cn } from '@/lib/utils'
import { GoalCell, VersusCell } from '@/components/YieldScoreCells'
import { CROP_DEFAULT } from '@/lib/forecast'

function SourceBadge({ label, title: why }: { label: string; title?: string }) {
  // Harvest yields stand out from estimates; a pre-clean one is flagged,
  // since it reads higher than what there will be to sell. A price or cost
  // carried from an earlier year shows that year, so a forecast built on
  // this year's numbers never passes for one somebody typed.
  const tone =
    label === 'pre-clean'
      ? 'bg-amber-100 text-amber-800'
      : label === 'clean'
        ? 'bg-green-100 text-green-800'
        : label === 'forecast'
          ? 'bg-sky-100 text-sky-800'
          : /^\d{4}$/.test(label) || label === CROP_DEFAULT
            ? 'bg-amber-50 text-amber-700'
            : 'bg-gray-100 text-gray-400'
  const title =
    why ??
    (label === 'pre-clean'
      ? 'Harvest yield from the scale, before clean-out'
      : label === 'clean'
        ? 'Harvest yield after clean-out'
        : undefined)
  return (
    <span title={title} className={`ml-1 rounded px-1 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}>
      {label}
    </span>
  )
}

const NEW_VARIETY = '__new__'

/** Variety picker: the crop's saved varieties + "Add new variety…". */
function VarietyCell({
  row,
  canEdit,
  varieties,
  onSet,
  onAdd,
}: {
  row: PlanRowView
  canEdit: boolean
  varieties: CropVarietyRow[]
  onSet: (v: string | null) => void
  onAdd: (name: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const current = row.plan?.variety ?? ''
  const cropId = row.crop?.id
  const mine = varieties.filter((v) => v.crop_id === cropId)
  // Include the current value even if it isn't a saved variety yet.
  const names = new Set(mine.map((v) => v.name))
  const options = [
    { value: '', label: '—' },
    ...mine.map((v) => ({ value: v.name, label: v.name })),
    ...(current && !names.has(current) ? [{ value: current, label: current }] : []),
    ...(cropId ? [{ value: NEW_VARIETY, label: '＋ Add new variety…' }] : []),
  ]
  return (
    <>
      <Select
        value={current}
        size="sm"
        ariaLabel="Variety"
        className="max-w-36"
        disabled={!canEdit || !row.plan || !cropId}
        onChange={(v) => {
          // The Select stays on `current` while the dialog is open, so cancelling
          // leaves the cell exactly as it was.
          if (v === NEW_VARIETY) {
            setAdding(true)
            return
          }
          onSet(v || null)
        }}
        options={options}
      />
      {adding && (
        <PromptDialog
          title={`New variety for ${row.crop?.name ?? 'crop'}`}
          label="Variety name"
          placeholder="e.g. AAC Brandon"
          confirmLabel="Add variety"
          onClose={() => setAdding(false)}
          onSubmit={(name) => {
            onAdd(name)
            onSet(name)
            setAdding(false)
          }}
        />
      )}
    </>
  )
}

/**
 * The four that answer one question: what is this year's crop worth.
 *
 * Rotation and Markets used to sit here too, and did not belong — rotation is
 * four years out and markets is what you check before selling. Both have their
 * own place under Crops now.
 */
// Farm costs is the fixed expense every budget here carries, so it is set here.
const PLAN_TABS = ['plan', 'budget', 'breakeven', 'actuals', 'field work', 'farm costs'] as const
type PlanTab = (typeof PLAN_TABS)[number]
// A crop-share partner plans his fields; the farm's fixed costs and our
// books (actuals) are not his.
const PARTNER_PLAN_TABS: readonly PlanTab[] = PLAN_TABS.filter((t) => t !== 'actuals' && t !== 'farm costs')

export function PlannerPage() {
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  const queryClient = useQueryClient()
  // Read the opening tab from the URL so a home-screen tile — or a link
  // pasted to somebody — can land on Rotation rather than on Plan with an
  // instruction to click twice. Only the initial value: after that the tabs
  // are ordinary state, and the URL is not rewritten on every click.
  const [params, setParams] = useSearchParams()
  const { partner, canWrite } = usePartnerAccess()
  const tabs = partner ? PARTNER_PLAN_TABS : PLAN_TABS
  const [tab, setTab] = useTab<PlanTab>('planner', tabs)

  // A crop id in the URL narrows the plan to that crop. The bin estimator links
  // here to answer "why is this number what it is" — landing on 60 rows of
  // every crop would not answer it.
  const cropParam = params.get('crop')

  // The plan and budget themselves are gathered in lib/reports/plan, which the
  // Reports page shares, so the two downloads are the same file.
  const { loaded, rows, budget, crops, varieties, deals, company, planPairs } = usePlanRows(cropYear)
  const { data: unlocks } = useYearUnlocks()
  const { add: addVariety } = useCropVarietyMutations()

  const currentYear = new Date().getFullYear()
  const isPastYear = cropYear < currentYear
  const isUnlocked = unlocks?.some((u) => u.crop_year === cropYear) ?? false
  const isLocked = isPastYear && !isUnlocked
  // Staff edit every row; a partner the rows of his own field-years.
  const canEditRow = (r: { field: { id: string } }) =>
    !isLocked && (hasManagerAccess(profile?.role) || canWrite(r.field.id, cropYear))

  const toggleLock = useMutation({
    mutationFn: async () => {
      if (isUnlocked) {
        const { error } = await supabase.from('year_unlocks').delete().eq('crop_year', cropYear)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('year_unlocks')
          .insert({ crop_year: cropYear, unlocked_by: profile?.id ?? null })
        if (error) throw error
      }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['year_unlocks'] }),
  })

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['crop_plans'] })

  const setCrop = useMutation({
    mutationFn: async ({ row, cropId }: { row: PlanRowView; cropId: string }) => {
      if (cropId === '') {
        if (row.plan) {
          const { error } = await supabase.from('crop_plans').delete().eq('id', row.plan.id)
          if (error) throw error
        }
        return
      }
      const { error } = await supabase.from('crop_plans').upsert(
        {
          crop_year: cropYear,
          field_id: row.field.id,
          crop_id: cropId,
          variety: row.plan?.variety ?? null,
          planned_acres: row.plan?.planned_acres ?? row.acres,
          yield_per_acre_override: null, // crop changed → old override is meaningless
          // …and so is its range.
          ...(row.plan?.yield_low != null || row.plan?.yield_high != null ? { yield_low: null, yield_high: null } : {}),
        },
        { onConflict: 'crop_year,field_id' },
      )
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const zoneMut = useCropZoneMutations()

  const patchPlan = useMutation({
    mutationFn: async ({
      row,
      patch,
    }: {
      row: PlanRowView
      patch: {
        variety?: string | null
        planned_acres?: number | null
        yield_per_acre_override?: number | null
        yield_low?: number | null
        yield_high?: number | null
      }
    }) => {
      if (!row.plan) return
      const { error } = await supabase.from('crop_plans').update(patch).eq('id', row.plan.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  // Land rented out for a flat rent (seed carrots and spinach) is paid once
  // for the deal, not per field, so it joins the totals here.
  const rentIn = useMemo(() => rentedOutIncome(deals ?? [], cropYear), [deals, cropYear])
  const totals = useMemo(() => {
    const planned = rows.filter((r) => r.plan || r.isZone)
    const acres = planned.reduce((s, r) => s + (r.acres ?? 0), 0)
    const rent = rentIn.reduce((s, r) => s + r.amount, 0)
    const revenue = planned.reduce((s, r) => s + (r.acres ?? 0) * r.revenuePerAcre, 0) + rent
    const cost = planned.reduce((s, r) => s + (r.acres ?? 0) * r.costPerAcre, 0)
    const marginLow = planned.reduce((s, r) => s + (r.acres ?? 0) * r.marginLowPerAcre, 0) + rent
    const marginHigh = planned.reduce((s, r) => s + (r.acres ?? 0) * r.marginHighPerAcre, 0) + rent
    const cutRows = planned.filter((r) => r.cutPct > 0)
    // What the cuts took off the revenue, at each row's price.
    const cutRevenue = cutRows.reduce((s, r) => s + (r.acres ?? 0) * r.revenueCutPerAcre, 0)
    return { acres, revenue, cost, margin: revenue - cost, marginLow, marginHigh, count: planned.length, rent, cutCount: cutRows.length, cutRevenue }
  }, [rows, rentIn])

  const shownRows = useMemo(
    () => (cropParam ? rows.filter((r) => (r.isZone ? r.crop?.id : r.plan?.crop_id) === cropParam) : rows),
    [rows, cropParam],
  )

  // What the CSV carries is shared with the Reports page (lib/reports/plan);
  // the inputs, pickers and badges are this screen's.
  const planColumns: DataTableColumn<PlanRowView>[] = withDisplay(planExportColumns(), {
    field: {
      className: 'font-medium',
      render: (r) => (
        <div className="flex items-center gap-1.5">
          {/* Sam, 7 Oct 2026: the field name opens the field; the row's cells stay inline-edited. */}
          <Link to={`/fields/${r.field.id}`} className="text-brand-700 hover:underline">
            {r.field.name}
          </Link>
          {r.warnings.length > 0 && (
            <span title={r.warnings.join('; ')}>
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            </span>
          )}
        </div>
      ),
    },
    acres: {
      className: 'text-right',
      render: (r) =>
        r.isZone ? (
          <div className="flex items-center justify-end gap-1">
            {/* A zone's acres edit here; its drawn area stays on the map. */}
            <input
              type="number"
              step="0.01"
              min="0"
              disabled={!canEditRow(r) || !r.zoneId}
              key={`${r.zoneId}-${r.acres ?? ''}`}
              defaultValue={r.acres ?? ''}
              placeholder="—"
              aria-label="Zone acres"
              onBlur={(e) => {
                const v = e.target.value === '' ? null : Number(e.target.value)
                if (v != null && (!Number.isFinite(v) || v < 0)) return
                if (r.zoneId && v !== r.acres) {
                  zoneMut.update.mutate({ id: r.zoneId, patch: { acres: v } })
                }
              }}
              className="w-24 rounded-md border border-gray-200 px-2 py-1 text-right text-sm tabular-nums"
            />
            <SourceBadge label="zone" />
          </div>
        ) : (
          <div className="flex items-center justify-end">
            <input
              type="number"
              step="0.01"
              disabled={!canEditRow(r) || !r.plan}
              defaultValue={r.plan?.planned_acres ?? ''}
              placeholder={r.acres != null ? r.acres.toFixed(2) : '—'}
              onBlur={(e) => {
                const v = e.target.value === '' ? null : Number(e.target.value)
                if (r.plan && v !== r.plan.planned_acres) {
                  patchPlan.mutate({ row: r, patch: { planned_acres: v } })
                }
              }}
              className="w-24 rounded-md border border-gray-200 px-2 py-1 text-right text-sm tabular-nums"
            />
            {r.acresSource && r.acresSource !== 'plan' && <SourceBadge label={r.acresSource} />}
          </div>
        ),
    },
    crop: {
      render: (r) =>
        r.isZone ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: cropColour(r.crop) }}
            />
            <Select
              disabled={!canEditRow(r)}
              value={r.crop?.id ?? ''}
              size="sm"
              ariaLabel="Zone crop"
              className="max-w-40"
              onChange={(v) =>
                r.zoneId && v && zoneMut.update.mutate({ id: r.zoneId, patch: { crop_id: v } })
              }
              options={[
                ...(crops ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: c.name })),
                ...(r.crop && !r.crop.active ? [{ value: r.crop.id, label: `${r.crop.name} (retired)` }] : []),
              ]}
            />
            <span
              className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-medium text-gray-500"
              title="Crop zone — crop and acres edit here; the drawn area edits on the map"
            >
              split
            </span>
          </span>
        ) : (
          <Select
            disabled={!canEditRow(r)}
            value={r.crop?.id ?? ''}
            size="sm"
            ariaLabel="Crop"
            className="max-w-44"
            onChange={(v) => setCrop.mutate({ row: r, cropId: v })}
            options={[
              { value: '', label: '—' },
              ...(crops ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: c.name })),
              // A plan on a retired crop (Canola, Potato) still shows it.
              ...(r.crop && !r.crop.active ? [{ value: r.crop.id, label: `${r.crop.name} (retired)` }] : []),
            ]}
          />
        ),
    },
    variety: {
      render: (r) => (
        <VarietyCell
          row={r}
          canEdit={canEditRow(r)}
          varieties={varieties ?? []}
          onSet={(v) => r.plan && patchPlan.mutate({ row: r, patch: { variety: v } })}
          onAdd={(name) => r.crop && addVariety.mutate({ crop_id: r.crop.id, name })}
        />
      ),
    },
    yield: {
      className: 'text-right',
      render: (r) => {
        const own = planYieldText(r.plan)
        return (
          <div className="flex flex-col items-end">
            <div className="flex items-center justify-end">
              {/* One figure or a range ("120-180"); a range alone expects its midpoint. */}
              <input
                type="text"
                inputMode="decimal"
                disabled={!canEditRow(r) || !r.plan}
                key={`${r.plan?.id ?? r.zoneId}-${own}`}
                defaultValue={own}
                // The yield the estimate is using, before any cut: our own
                // average, or the goal, or the crop's range.
                placeholder={
                  !own && r.yieldBeforeCut != null
                    ? r.cut && r.cutPct > 0
                      ? String(Math.round(r.yieldBeforeCut * 10) / 10)
                      : formatYieldRange({ low: r.yieldLow, expected: r.yieldPerAcre, high: r.yieldHigh }) || '—'
                    : '—'
                }
                title={r.yieldNote || undefined}
                aria-label="Yield per acre, or a range"
                onBlur={(e) => {
                  if (!r.plan) return
                  const parsed = parseYieldText(e.target.value)
                  if (!parsed) {
                    e.target.value = own
                    return
                  }
                  const hadRange = r.plan.yield_low != null || r.plan.yield_high != null
                  const next =
                    parsed.kind === 'range'
                      ? { yield_per_acre_override: null, yield_low: parsed.low, yield_high: parsed.high }
                      : { yield_per_acre_override: parsed.kind === 'point' ? parsed.value : null, yield_low: null, yield_high: null }
                  const same =
                    next.yield_per_acre_override === (r.plan.yield_per_acre_override ?? null) &&
                    next.yield_low === (r.plan.yield_low ?? null) &&
                    next.yield_high === (r.plan.yield_high ?? null)
                  // A single figure leaves the range columns alone unless there is a range to clear.
                  const patch = parsed.kind === 'range' || hadRange ? next : { yield_per_acre_override: next.yield_per_acre_override }
                  if (!same) patchPlan.mutate({ row: r, patch })
                }}
                className="w-24 rounded-md border border-gray-200 px-2 py-1 text-right text-sm tabular-nums"
              />
              {r.yieldSource && <SourceBadge label={r.yieldSource === 'goal' ? CROP_DEFAULT : r.yieldSource} title={r.yieldNote || undefined} />}
            </div>
            {r.cutPct > 0 && r.yieldPerAcre != null && (
              <span className="mt-0.5 text-[11px] font-medium tabular-nums text-amber-800">
                {(Math.round(r.yieldPerAcre * 10) / 10).toLocaleString('en-CA')} after cut
              </span>
            )}
          </div>
        )
      },
    },
    yield_range: {
      className: 'text-right tabular-nums text-xs text-gray-500',
      render: (r) => {
        const range = { low: r.yieldLow, expected: r.yieldPerAcre, high: r.yieldHigh }
        return isRange(range) ? formatYieldRange(range) : ''
      },
    },
    cut: {
      render: (r) =>
        r.cut ? (
          <Link
            to={`/fields/${r.field.id}#yield-cuts`}
            className={cn(
              'inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium',
              r.cutPct > 0 ? 'bg-amber-100 text-amber-900 hover:bg-amber-200' : 'bg-gray-100 text-gray-500',
            )}
            title={
              r.cutPct > 0
                ? `Estimate cut from ${r.yieldBeforeCut != null ? Math.round(r.yieldBeforeCut * 10) / 10 : '—'} to ${r.yieldPerAcre != null ? Math.round(r.yieldPerAcre * 10) / 10 : '—'} ${r.crop?.yield_unit ?? ''}/ac — open the field to change it`
                : 'Harvested off the scale: the loss is already in the yield, so the cut is not applied'
            }
          >
            {r.cutPct > 0 ? cutLabel(r.cut) : `${r.cut.reason} — harvested, not applied`}
          </Link>
        ) : (
          ''
        ),
    },
    goal: { className: 'text-right', render: (r) => <GoalCell row={r} canEdit={canEditRow(r)} /> },
    // The "not a normal year" mark is about the averages, not the plan, so a locked year can still be marked.
    vs_estimate: {
      render: (r) => (
        <VersusCell
          score={r.score}
          mark={r.crop ? { fieldId: r.field.id, cropId: r.crop.id, cropYear, cropName: r.crop.name, canEdit: hasManagerAccess(profile?.role) } : undefined}
        />
      ),
    },
    price: {
      className: 'text-right tabular-nums',
      render: (r) =>
        r.crop ? (
          r.pricePerUnit != null ? (
            <span className="inline-flex items-center justify-end gap-1" title={r.priceNote || undefined}>
              {money2(r.pricePerUnit)}/{r.crop.yield_unit}
              {r.priceSource === 'contract' && (
                <span
                  className="rounded bg-green-100 px-1 py-0.5 text-[10px] uppercase text-green-700"
                  title="From a signed contract"
                >
                  ctr
                </span>
              )}
              {r.priceBadge && <SourceBadge label={r.priceBadge} title={r.priceNote} />}
            </span>
          ) : r.crop.land_rent_only ? (
            <span className="text-xs text-gray-400">rented out</span>
          ) : (
            '—'
          )
        ) : (
          ''
        ),
    },
    cost_ac: {
      className: 'text-right tabular-nums',
      render: (r) =>
        r.plan || r.isZone ? (
          <span className="inline-flex items-center justify-end gap-1" title={r.costNote || undefined}>
            {money2(r.costPerAcre)}
            {r.costBadge && <SourceBadge label={r.costBadge} title={r.costNote} />}
          </span>
        ) : (
          ''
        ),
    },
    margin_ac: {
      className: 'text-right tabular-nums',
      render: (r) =>
        r.plan || r.isZone ? (
          <span className={r.marginPerAcre < 0 ? 'text-red-600' : ''}>
            {money2(r.marginPerAcre)}
            {r.dealNote && <span className="block text-[10px] font-normal text-gray-400">{r.dealNote}</span>}
          </span>
        ) : (
          ''
        ),
    },
    margin_total: {
      className: 'text-right tabular-nums',
      render: (r) =>
        (r.plan || r.isZone) && r.acres != null ? (
          <span className={r.marginPerAcre < 0 ? 'text-red-600' : ''}>
            {money(r.marginPerAcre * r.acres)}
          </span>
        ) : (
          ''
        ),
    },
    margin_range: {
      className: 'text-right tabular-nums text-xs text-gray-500',
      render: (r) =>
        (r.plan || r.isZone) && r.acres != null && r.marginHighPerAcre - r.marginLowPerAcre > 0.005
          ? `${money(r.marginLowPerAcre * r.acres)} to ${money(r.marginHighPerAcre * r.acres)}`
          : '',
    },
  })

  const budgetColumns: DataTableColumn<(typeof budget)[number]>[] = withDisplay(budgetExportColumns(planPairs, company), {
    crop: { className: 'font-medium' },
    fields: { className: 'text-right' },
    acres: {
      className: 'text-right tabular-nums',
    },
    yield: {
      render: (b) =>
        b.weightedYield != null ? `${b.weightedYield.toFixed(1)} ${b.crop.yield_unit}` : '—',
      className: 'text-right tabular-nums',
    },
    price: {
      render: (b) =>
        b.pricePerUnit != null ? `${money2(b.pricePerUnit)}/${b.crop.yield_unit}` : '—',
      className: 'text-right tabular-nums',
    },
    revenue: {
      render: (b) => money(b.revenue),
      className: 'text-right tabular-nums',
    },
    cost_ac: {
      render: (b) => money2(b.costPerAcre),
      className: 'text-right tabular-nums',
    },
    cost: {
      render: (b) => money(b.cost),
      className: 'text-right tabular-nums',
    },
    margin_ac: {
      render: (b) => (
        <span className={b.marginPerAcre < 0 ? 'text-red-600' : ''}>{money2(b.marginPerAcre)}</span>
      ),
      className: 'text-right tabular-nums',
    },
    margin: {
      render: (b) => <span className={b.margin < 0 ? 'text-red-600' : ''}>{money(b.margin)}</span>,
      className: 'text-right tabular-nums',
    },
    yield_range: {
      className: 'text-right tabular-nums text-xs text-gray-500',
      render: (b) => {
        const r = { low: b.weightedYieldLow, expected: b.weightedYield, high: b.weightedYieldHigh }
        return isRange(r) ? formatYieldRange(r) : ''
      },
    },
    cut: {
      className: 'text-right tabular-nums',
      render: (b) =>
        b.cutQuantity > 0 ? (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900" title={`${b.cutCount} field${b.cutCount === 1 ? '' : 's'} cut for hail or disease`}>
            −{Math.round(b.cutQuantity).toLocaleString('en-CA')} {b.crop.yield_unit}
          </span>
        ) : (
          ''
        ),
    },
    margin_range: {
      className: 'text-right tabular-nums text-xs text-gray-500',
      render: (b) => (b.marginHigh - b.marginLow > 0.005 ? `${money(b.marginLow)} to ${money(b.marginHigh)}` : ''),
    },
    be_price: {
      render: (b) =>
        b.breakEvenPrice != null ? `${money2(b.breakEvenPrice)}/${b.crop.yield_unit}` : '—',
      className: 'text-right tabular-nums',
    },
    be_yield: {
      render: (b) =>
        b.breakEvenYield != null ? `${b.breakEvenYield.toFixed(1)} ${b.crop.yield_unit}/ac` : '—',
      className: 'text-right tabular-nums',
    },
  })

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-lg font-semibold text-gray-900">Financials · {cropYear}</h1>
        {/* The tab bar can shrink (min-w-0), so its ▾ takes the tabs that do
            not fit instead of the row pushing the whole page sideways; on a
            phone it takes a line of its own (Sam, 27 Oct 2026). */}
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          <PillTabs
            tabs={tabs.map((t) => ({ key: t, label: t[0].toUpperCase() + t.slice(1) }))}
            value={tab}
            onChange={setTab}
            className="border-b-0 pb-0"
          />
          {tab === 'budget' && (
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Printer className="h-3.5 w-3.5" /> Print / PDF
            </button>
          )}
        </div>
      </div>

      {/* Owners and the accountant only; renders nothing for anyone else. */}
      <QbAskBar className="mb-4" />

      {isPastYear && (
        <div
          className={`mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm print:hidden ${
            isLocked
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-red-300 bg-red-50 text-red-900'
          }`}
        >
          <span className="flex items-center gap-2">
            {isLocked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
            {isLocked
              ? `${cropYear} is a past year — read-only.`
              : `${cropYear} is UNLOCKED for corrections. Re-lock when done (unlocks are audited).`}
          </span>
          {hasManagerAccess(profile?.role) && (
            <button
              onClick={() => toggleLock.mutate()}
              disabled={toggleLock.isPending}
              className="rounded-md border border-current px-2.5 py-1 text-xs font-semibold hover:opacity-80 disabled:opacity-50"
            >
              {isLocked ? 'Unlock for corrections' : 'Re-lock year'}
            </button>
          )}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ['Planted fields', String(totals.count), null],
            ['Acres', totals.acres.toLocaleString('en-CA', { maximumFractionDigits: 0 }), null],
            [
              'Projected revenue',
              money(totals.revenue),
              totals.cutCount > 0 ? `${money(totals.cutRevenue)} cut on ${totals.cutCount} field${totals.cutCount === 1 ? '' : 's'}` : null,
            ],
            [
              'Projected margin',
              money(totals.margin),
              totals.marginHigh - totals.marginLow > 0.5 ? `${money(totals.marginLow)} to ${money(totals.marginHigh)}` : null,
            ],
          ] as const
        ).map(([label, val, sub]) => (
          <div key={label} className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="mt-0.5 text-lg font-bold text-gray-900">{val}</p>
            {sub && <p className={cn('text-[11px] tabular-nums', label === 'Projected revenue' ? 'text-amber-800' : 'text-gray-500')}>{sub}</p>}
          </div>
        ))}
      </div>

      {totals.rent > 0 && tab !== 'field work' && (
        <p className="-mt-2 mb-4 text-xs text-gray-500">
          Revenue includes land rented out:{' '}
          {rentIn.map((r) => `${money(r.amount)} from ${r.landlord}`).join(', ')}.
        </p>
      )}

      {tab === 'field work' ? (
        <PlannedVsActual cropYear={cropYear} />
      ) : tab === 'farm costs' ? (
        <FarmCostsTab year={cropYear} locked={isLocked} />
      ) : !loaded ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : tab === 'plan' ? (
        <>
          {cropParam && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900">
              <span>
                Showing{' '}
                <strong>{crops?.find((c) => c.id === cropParam)?.name ?? 'one crop'}</strong> only —{' '}
                {shownRows.length} of {rows.length} rows.
              </span>
              <button
                onClick={() =>
                  setParams((p) => {
                    const next = new URLSearchParams(p)
                    next.delete('crop')
                    return next
                  })
                }
                className="ml-auto rounded-md border border-brand-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-brand-50"
              >
                Show every crop
              </button>
            </div>
          )}
          {zoneMut.update.error && (
            <p className="text-xs text-red-700">
              Crop area not saved: {(zoneMut.update.error as Error).message}
            </p>
          )}
          <DataTable
            rows={shownRows}
            columns={planColumns}
            rowKey={(r) => r.zoneId ?? r.field.id}
            exportFilename={`crop-plan-${cropYear}`}
          />
        </>
      ) : tab === 'budget' ? (
        <DataTable
          rows={budget}
          columns={budgetColumns}
          rowKey={(b) => b.crop.id}
          exportFilename={`budget-${cropYear}`}
        />
      ) : tab === 'breakeven' ? (
        // The budget divided by the yield the plan expects. It sits next to the
        // budget because it is the budget, said in the unit a price is quoted in.
        <BreakevenTab year={cropYear} />
      ) : (
        <ActualsTab budget={budget} locked={isLocked} />
      )}
    </div>
  )
}
