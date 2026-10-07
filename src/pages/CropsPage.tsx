import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, ArchiveRestore, Pencil, Trash2 } from 'lucide-react'
import { Plus } from 'lucide-react'
import { DataTable, type DataTableColumn } from '@/components/DataTable'
import { Select } from '@/components/Select'

/** Units a crop's yield can be recorded in — matches the database enum. */
const YIELD_UNITS = ['bu', 'lbs', 'cwt', 'ton', 'MT', 'ac'] as const
import { ConfirmDialog, Modal } from '@/components/Modal'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import { useCropMutations, useCrops, type CropRow } from '@/lib/queries'
import { useAllCropInputs, useAllCropPrices, useYieldHistory } from '@/lib/forecast-data'
import { basisBadge, type ResolvedCost, type ResolvedPrice } from '@/lib/forecast'
import { withDisplay } from '@/lib/reports/columns'
import { cropListColumns, cropListRows, type CropListRow } from '@/lib/reports/lists'
import { useElevatorBids } from '@/components/BreakevenCard'
import { useSetCropNeedsBins } from '@/lib/bins'
import { ColourPicker } from '@/components/ColourPicker'
import { cropColour } from '@/lib/crop-colour'
import { useSetCropColour } from '@/lib/crop-colour-mutation'
import { money2 } from '@/lib/planner'
import { cn } from '@/lib/utils'

type Row = CropListRow

/** "2026" / "forecast" / "market" beside a figure that isn't this year's own. */
function Basis({ b, title }: { b: { basis: ResolvedPrice['basis'] | ResolvedCost['basis']; fromYear: number | null }; title: string }) {
  const t = basisBadge(b)
  if (!t) return null
  return (
    <span title={title} className={cn('ml-1 rounded px-1 py-0.5 text-[10px] uppercase tracking-wide', t === 'forecast' ? 'bg-sky-100 text-sky-800' : t === 'market' ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-700')}>
      {t}
    </span>
  )
}

export function CropsPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  const { data: crops, isLoading } = useCrops()
  const { data: prices } = useAllCropPrices()
  const { data: inputs } = useAllCropInputs()
  const { data: history } = useYieldHistory()
  const { data: bidList } = useElevatorBids()
  const { setArchived, remove, create } = useCropMutations()
  const setNeedsBins = useSetCropNeedsBins()
  const setColour = useSetCropColour()
  const isManager = hasManagerAccess(profile?.role)

  const [tab, setTab] = useState<'active' | 'archive'>('active')
  const [deleting, setDeleting] = useState<CropRow | null>(null)
  const [adding, setAdding] = useState<{ name: string; unit: CropRow['yield_unit'] } | null>(null)

  const active = useMemo(() => (crops ?? []).filter((c) => c.active), [crops])
  const archived = useMemo(() => (crops ?? []).filter((c) => !c.active), [crops])

  // The same price, cost and yield the plan and budget use for this year.
  const rows = useMemo<Row[]>(
    () =>
      cropListRows(tab === 'active' ? active : archived, {
        cropYear,
        prices: prices ?? [],
        inputs: inputs ?? [],
        history: history ?? [],
        bids: new Map(bidList ?? []),
      }),
    [tab, active, archived, prices, inputs, history, bidList, cropYear],
  )

  // The CSV's columns are shared with the Reports page; the screen adds the
  // pickers, badges and tooltips.
  const columns: DataTableColumn<Row>[] = withDisplay(cropListColumns(cropYear), {
    // The colour this crop is drawn in everywhere — bin fills, field maps, the
    // rotation grid. One row in the database, so the whole crew sees the same
    // green for corn rather than each screen inventing its own.
    colour: {
      render: (r) => (
        <span onClick={(e) => e.stopPropagation()} className="inline-block">
          {isManager ? (
            <ColourPicker
              value={cropColour(r)}
              ariaLabel={`Colour for ${r.name}`}
              onCommit={(hex) => setColour.mutate({ id: r.id, color: hex })}
            />
          ) : (
            <span
              className="inline-block h-5 w-5 rounded-full border border-black/15"
              style={{ background: cropColour(r) }}
            />
          )}
        </span>
      ),
    },
    name: { className: 'font-medium' },
    // No Unit column: the unit is written into the yield and price cells.
    // What estimates use: our own harvested average once there is one, the
    // normal yield until then. The normal yield is in the tooltip — it was a
    // column of its own and, until there is a harvest, the same number twice.
    expected_yield: {
      render: (r) => {
        if (r.land_rent_only) return <span className="text-xs text-gray-400">land rented out</span>
        const normal =
          r.default_yield_per_acre != null
            ? `Normal yield: ${r.default_yield_per_acre.toLocaleString('en-CA')} ${r.yield_unit}/ac`
            : 'No normal yield set'
        if (r.expected.value == null) {
          return r.default_yield_per_acre != null ? (
            <span title={normal}>
              {r.default_yield_per_acre.toLocaleString('en-CA')} {r.yield_unit}/ac
            </span>
          ) : (
            '—'
          )
        }
        return (
          <span title={`${normal}\n${r.expected.label}`}>
            {(Math.round(r.expected.value * 10) / 10).toLocaleString('en-CA')} {r.yield_unit}/ac
            <span className="ml-1 text-[10px] uppercase text-gray-400">{r.expected.basis === 'goal' ? 'goal' : r.expected.basis === 'farm' ? 'farm avg' : 'field avg'}</span>
          </span>
        )
      },
      className: 'text-right tabular-nums',
    },
    price: {
      render: (r) =>
        r.land_rent_only ? (
          <span className="text-xs text-gray-400">land rented out</span>
        ) : r.price.value != null ? (
          <span title={r.price.label}>
            {r.yield_unit === 'lbs' ? `$${r.price.value.toFixed(3)}` : money2(r.price.value)}/{r.yield_unit}
            <Basis b={r.price} title={r.price.basis === 'carried' ? `Using the ${r.price.fromYear} price — open the crop to set a ${cropYear} forecast` : r.price.label} />
          </span>
        ) : (
          '—'
        ),
      className: 'text-right tabular-nums',
    },
    // Whether the crop goes in a bin at all. Alfalfa is baled and some corn
    // goes straight to the plant, and counting either against bin space made
    // the estimator ask for storage nobody needs. The bin estimator can still
    // override this for one year without changing the crop itself.
    binned: {
      render: (r) =>
        isManager ? (
          <label className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={r.needs_bins !== false}
              disabled={setNeedsBins.isPending}
              onChange={(e) => setNeedsBins.mutate({ id: r.id, needs_bins: e.target.checked })}
              aria-label={`${r.name} is stored in bins`}
            />
          </label>
        ) : (
          <span className="text-xs text-gray-600">{r.needs_bins !== false ? 'yes' : 'no'}</span>
        ),
    },
    cost: {
      render: (r) =>
        r.cost.total ? (
          <span title={r.cost.label}>
            {money2(r.cost.total)}
            <Basis b={r.cost} title={r.cost.basis === 'carried' ? `Using the ${r.cost.fromYear} input budget — open the crop to make a ${cropYear} forecast` : r.cost.label} />
          </span>
        ) : (
          '—'
        ),
      className: 'text-right tabular-nums',
    },
  })
  if (isManager) {
    columns.push({
      key: 'actions',
      label: '',
      value: () => '',
      className: 'text-right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => navigate(`/crops/${r.id}`)}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            title="Edit crop"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => setArchived.mutate({ id: r.id, archived: r.active })}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            title={r.active ? 'Archive crop' : 'Restore crop'}
          >
            {r.active ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
          </button>
          {!r.active && (
            <button
              onClick={() => setDeleting(r)}
              className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
              title="Permanently delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    })
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold text-gray-900">Crops</h1>
        <div className="flex rounded-md border border-gray-200 bg-white p-0.5 text-sm">
          {(['active', 'archive'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded px-3 py-1 capitalize',
                tab === t
                  ? 'bg-brand-700 font-semibold text-white'
                  : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              {t} ({t === 'active' ? active.length : archived.length})
            </button>
          ))}
        </div>

        {isManager && (
          <button
            onClick={() => setAdding({ name: '', unit: 'bu' })}
            className="ml-auto flex items-center gap-1.5 rounded-md bg-brand-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
          >
            <Plus className="h-3.5 w-3.5" /> Add crop
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          exportFilename={`crops-${tab}-${cropYear}`}
          onRowClick={(r) => navigate(`/crops/${r.id}`)}
          emptyMessage={tab === 'archive' ? 'No archived crops.' : 'No crops yet.'}
        />
      )}

      {adding && (
        <Modal title="Add a crop" onClose={() => setAdding(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              create.mutate(
                { name: adding.name, yield_unit: adding.unit },
                // Straight to the new crop's page: a crop is not finished
                // being set up when it has a name, and that page is where the
                // yield, colour and bin policy are.
                { onSuccess: (id) => navigate(`/crops/${id}`) },
              )
            }}
            className="space-y-3"
          >
            <label className="block text-xs text-gray-500">
              Name
              <input
                autoFocus
                value={adding.name}
                onChange={(e) => setAdding({ ...adding, name: e.target.value })}
                placeholder="Flax"
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
              />
            </label>
            <label className="block text-xs text-gray-500">
              Yield unit
              <Select
                value={adding.unit}
                ariaLabel="Yield unit"
                className="mt-1"
                onChange={(v) => setAdding({ ...adding, unit: v as CropRow['yield_unit'] })}
                options={YIELD_UNITS.map((u) => ({ value: u, label: u }))}
              />
            </label>
            <p className="text-xs text-gray-500">
              Yield, test weight, colour and bin policy are set on the crop’s own page next.
            </p>
            {create.error && (
              <p className="text-xs text-red-700">{(create.error as Error).message}</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setAdding(null)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!adding.name.trim() || create.isPending}
                className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
              >
                {create.isPending ? 'Adding…' : 'Add crop'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          message={
            <>
              Permanently delete <b>{deleting.name}</b>? This can’t be undone. A crop that has been
              used in any crop plan or past crop history can’t be deleted and will stay archived.
            </>
          }
          confirmLabel="Delete permanently"
          busy={remove.isPending}
          error={remove.isError ? (remove.error as Error).message : null}
          onClose={() => {
            remove.reset()
            setDeleting(null)
          }}
          onConfirm={() =>
            remove.mutate(deleting.id, {
              onSuccess: () => setDeleting(null),
            })
          }
        />
      )}
    </div>
  )
}
