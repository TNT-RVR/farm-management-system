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
          : /^\d{4}$/.test(label)
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

export function PlannerPage() {
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  const queryClient = useQueryClient()
  // Read the opening tab from the URL so a home-screen tile — or a link
  // pasted to somebody — can land on Rotation rather than on Plan with an
  // instruction to click twice. Only the initial value: after that the tabs
  // are ordinary state, and the URL is not rewritten on every click.
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useTab<PlanTab>('planner', PLAN_TABS, 'plan')

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
  const canEdit = hasManagerAccess(profile?.role) && !isLocked

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
    return { acres, revenue, cost, margin: revenue - cost, count: planned.length, rent }
  }, [rows, rentIn])

  const shownRows = useMemo(
    () => (cropParam ? rows.filter((r) => r.plan?.crop_id === cropParam) : rows),
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
            <span className="tabular-nums">{r.acres != null ? r.acres.toFixed(1) : '—'}</span>
            <SourceBadge label="zone" />
          </div>
        ) : (
          <div className="flex items-center justify-end">
            <input
              type="number"
              step="0.01"
              disabled={!canEdit || !r.plan}
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
              disabled={!canEdit}
              value={r.crop?.id ?? ''}
              size="sm"
              ariaLabel="Zone crop"
              className="max-w-40"
              onChange={(v) =>
                r.zoneId && v && zoneMut.update.mutate({ id: r.zoneId, patch: { crop_id: v } })
              }
              options={(crops ?? [])
                .filter((c) => c.active)
                .map((c) => ({ value: c.id, label: c.name }))}
            />
            <span
              className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-medium text-gray-500"
              title="Crop zone — acres/area edited on the map"
            >
              split
            </span>
          </span>
        ) : (
          <Select
            disabled={!canEdit}
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
          canEdit={canEdit}
          varieties={varieties ?? []}
          onSet={(v) => r.plan && patchPlan.mutate({ row: r, patch: { variety: v } })}
          onAdd={(name) => r.crop && addVariety.mutate({ crop_id: r.crop.id, name })}
        />
      ),
    },
    yield: {
      className: 'text-right',
      render: (r) => (
        <div className="flex items-center justify-end">
          <input
            type="number"
            disabled={!canEdit || !r.plan}
            defaultValue={r.plan?.yield_per_acre_override ?? ''}
            // The yield the estimate is using: our own average, or the goal.
            placeholder={
              r.yieldPerAcre != null && r.plan?.yield_per_acre_override == null
                ? String(Math.round(r.yieldPerAcre * 10) / 10)
                : '—'
            }
            title={r.yieldNote || undefined}
            onBlur={(e) => {
              const v = e.target.value === '' ? null : Number(e.target.value)
              if (r.plan && v !== r.plan.yield_per_acre_override) {
                patchPlan.mutate({ row: r, patch: { yield_per_acre_override: v } })
              }
            }}
            className="w-20 rounded-md border border-gray-200 px-2 py-1 text-right text-sm tabular-nums"
          />
          {r.yieldSource && <SourceBadge label={r.yieldSource} title={r.yieldNote || undefined} />}
        </div>
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
        <div className="flex items-center gap-2">
          <PillTabs
            tabs={PLAN_TABS.map((t) => ({ key: t, label: t[0].toUpperCase() + t.slice(1) }))}
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
        {[
          ['Planted fields', String(totals.count)],
          ['Acres', totals.acres.toLocaleString('en-CA', { maximumFractionDigits: 0 })],
          ['Projected revenue', money(totals.revenue)],
          ['Projected margin', money(totals.margin)],
        ].map(([label, val]) => (
          <div key={label} className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="mt-0.5 text-lg font-bold text-gray-900">{val}</p>
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
