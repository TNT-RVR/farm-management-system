import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Flag, Pencil, RotateCcw, Scale, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCropYear } from '@/lib/crop-year'
import { useCrops, useYearUnlocks } from '@/lib/queries'
import { deleteNeedsPlanRestore, fillYieldPair, isCropYearLocked } from '@/lib/crop-history-edit'
import { ConfirmDialog } from '@/components/Modal'
import { AddButton, RecordEditModal, type EditField } from '@/components/RecordEditor'
import { fieldHarvestSoFar, useBinLoads, useDeliverySites, useSetLastLoad, useUseScaleYield, type FieldYield } from '@/lib/bin-loads'
import { useBins } from '@/lib/bins'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'
import { DeleteLoadButton } from '@/pages/bins/WeighIn'
import { TRAIT_LABEL, TRAIT_SHORT, type HerbicideTrait } from '@/lib/canola-trait'

const SOURCE_LABEL: Record<string, string> = {
  scale: 'Scale loads',
  manual: 'Typed',
  fah_import: 'Farm at Hand',
  jd_import: 'John Deere',
  rotation_xlsx: 'Rotation sheet',
}

const UNITS = ['bu', 'lbs', 'cwt', 'ton', 'MT', 'ac'] as const
type YieldUnit = (typeof UNITS)[number]

const num = (v: number | string | null | undefined, digits = 0) =>
  v == null ? '—' : Number(v).toLocaleString('en-CA', { maximumFractionDigits: digits })

/**
 * A field's yields, year by year, and this season's harvest as it comes in.
 *
 * The scale writes a season's yield when the last load off the field is
 * marked. Typing over the per-acre or the total keeps the typed figure (the
 * scale's stays beside it) until "use the scale figure" is pressed. Either
 * number can be typed; the other follows from the acres.
 */
export function FieldYieldHistory({
  fieldId,
  history,
  cropName,
  canEdit,
  canolaTrait,
}: {
  fieldId: string
  history: FieldYield[]
  cropName: (id: string) => string
  canEdit: boolean
  /** A canola's herbicide trait (null trait = not known); null for any other crop. */
  canolaTrait?: (cropId: string, variety: string | null) => { trait: HerbicideTrait | null; from: string | null } | null
}) {
  const qc = useQueryClient()
  const { cropYear } = useCropYear()
  const { data: loads } = useBinLoads()
  const setLast = useSetLastLoad()
  const { data: bins } = useBins()
  const { data: sites } = useDeliverySites()
  const [showLoads, setShowLoads] = useState(false)
  const resetToScale = useUseScaleYield()
  const [error, setError] = useState('')
  const { data: crops } = useCrops()
  const { data: unlocks } = useYearUnlocks()
  const locked = (y: number) => isCropYearLocked(y, (unlocks ?? []).map((u) => u.crop_year))
  // Sam, 7 Oct 2026: a past year's row can be added by hand, its crop and
  // variety corrected, and a wrong row deleted.
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<FieldYield | null>(null)
  const [deleting, setDeleting] = useState<FieldYield | null>(null)
  const invalidate = () =>
    void qc.invalidateQueries({
      predicate: (q) => ['crop_history', 'crop_plans', 'crop_position', 'field_yield', 'fert_crop_history'].includes(String(q.queryKey[0])),
    })

  const save = useMutation({
    mutationFn: async (v: { id: string; patch: Partial<Pick<FieldYield, 'acres' | 'yield_per_acre' | 'actual_yield_total' | 'clean_total' | 'clean_yield_per_acre'>> }) => {
      const { error } = await supabase.from('crop_history').update(v.patch).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: () => {
      setError('')
      void qc.invalidateQueries({
        predicate: (q) => ['crop_history', 'crop_plans', 'crop_position', 'field_yield', 'fert_crop_history'].includes(String(q.queryKey[0])),
      })
    },
    onError: (e) => setError((e as Error).message),
  })

  const add = useMutation({
    mutationFn: async (p: Record<string, unknown>) => {
      const year = Number(p.crop_year)
      if (!Number.isInteger(year) || year < 1950 || year > cropYear + 1) throw new Error('Give the crop year as four digits.')
      if (history.some((h) => h.crop_year === year)) throw new Error(`${year} already has a row; change it in the table.`)
      if (locked(year)) throw new Error(`${year} is locked. Unlock it for corrections on the Planner first.`)
      const acres = (p.acres as number | null) ?? null
      const pre = fillYieldPair(acres, (p.yield_per_acre as number | null) ?? null, (p.actual_yield_total as number | null) ?? null)
      const clean = fillYieldPair(acres, (p.clean_yield_per_acre as number | null) ?? null, (p.clean_total as number | null) ?? null)
      const { error } = await supabase.from('crop_history').insert({
        field_id: fieldId,
        crop_year: year,
        crop_id: p.crop_id as string,
        variety: (p.variety as string | null) ?? null,
        acres,
        yield_unit: ((p.yield_unit as string | null) ?? null) as YieldUnit | null,
        yield_per_acre: pre.perAcre,
        actual_yield_total: pre.total,
        clean_yield_per_acre: clean.perAcre,
        clean_total: clean.total,
        source: 'manual',
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const editMeta = useMutation({
    mutationFn: async ({ id, p }: { id: string; p: Record<string, unknown> }) => {
      const patch: { variety: string | null; yield_unit: YieldUnit | null; crop_id?: string } = {
        variety: (p.variety as string | null) ?? null,
        yield_unit: ((p.yield_unit as string | null) ?? null) as YieldUnit | null,
      }
      if (p.crop_id) patch.crop_id = p.crop_id as string
      const { error } = await supabase.from('crop_history').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: async (h: FieldYield) => {
      if (deleteNeedsPlanRestore(h) && !locked(h.crop_year)) {
        // Clearing the yield first is what makes the after-trigger give the
        // season's plan its estimate back; a bare delete would leave it.
        const { error } = await supabase
          .from('crop_history')
          .update({ yield_per_acre: null, actual_yield_total: null, clean_yield_per_acre: null, clean_total: null })
          .eq('id', h.id)
        if (error) throw error
      }
      const { error } = await supabase.from('crop_history').delete().eq('id', h.id)
      if (error) throw error
    },
    onSuccess: () => {
      setDeleting(null)
      invalidate()
    },
  })

  const unitOptions = [{ value: '', label: '—' }, ...UNITS.map((u) => ({ value: u, label: u }))]
  const metaFields = (h: FieldYield | null): EditField[] => [
    ...(h ? [] : [{ key: 'crop_year', label: 'Crop year', kind: 'number' as const, int: true, required: true }]),
    // The plan follows this row by crop; once it has taken this row's yield the crop stays put.
    ...(h?.plan_yield_saved
      ? []
      : [
          {
            key: 'crop_id',
            label: 'Crop',
            kind: 'select' as const,
            required: true,
            options: (crops ?? []).filter((c) => c.active || c.id === h?.crop_id).map((c) => ({ value: c.id, label: c.name })),
          },
        ]),
    { key: 'variety', label: 'Variety', kind: 'text' },
    { key: 'yield_unit', label: 'Unit', kind: 'select', options: unitOptions, hint: 'Left blank, a new row takes the crop\'s unit.' },
    ...(h
      ? []
      : ([
          { key: 'acres', label: 'Acres', kind: 'number' },
          { key: 'yield_per_acre', label: 'Pre-clean / ac', kind: 'number', hint: 'Field-run, before cleaning. Give per acre or total.' },
          { key: 'actual_yield_total', label: 'Pre-clean total', kind: 'number' },
          { key: 'clean_yield_per_acre', label: 'Clean / ac', kind: 'number', hint: 'What was left after cleaning. Give per acre or total.' },
          { key: 'clean_total', label: 'Clean total', kind: 'number' },
        ] satisfies EditField[])),
  ]

  const season = fieldHarvestSoFar(loads ?? [], fieldId, cropYear)
  const thisYear = history.find((h) => h.crop_year === cropYear)

  const cell = (h: FieldYield, key: 'acres' | 'yield_per_acre' | 'actual_yield_total' | 'clean_total' | 'clean_yield_per_acre', width: string) => (
    <input
      key={`${h.id}:${key}:${h[key] ?? ''}`}
      type="number"
      inputMode="decimal"
      disabled={!canEdit || save.isPending}
      defaultValue={h[key] ?? ''}
      placeholder="—"
      onBlur={(e) => {
        const v = e.target.value === '' ? null : Number(e.target.value)
        const cur = h[key] == null ? null : Number(h[key])
        if (v !== cur && (v == null || Number.isFinite(v))) save.mutate({ id: h.id, patch: { [key]: v } })
      }}
      className={cn('rounded-md border border-gray-200 bg-white px-2 py-1 text-right text-sm tabular-nums disabled:bg-transparent disabled:text-gray-700', width)}
    />
  )

  return (
    <div className="mt-4 space-y-3">
      {season.loads > 0 && (
        <div
          className={cn(
            'rounded-lg border p-3 text-sm',
            season.last ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50',
          )}
        >
          <p className={cn('flex items-center gap-1.5 font-semibold', season.last ? 'text-green-900' : 'text-amber-900')}>
            {season.last ? <Flag className="h-4 w-4" fill="currentColor" /> : <Scale className="h-4 w-4" />}
            {cropYear} harvest {season.last ? 'done' : 'in progress'}: {season.loads} load{season.loads === 1 ? '' : 's'},{' '}
            {num(season.bushels)} bu
          </p>
          <p className={cn('text-xs', season.last ? 'text-green-900/80' : 'text-amber-900/80')}>
            {num(season.bushels - season.toPlant)} bu into bins
            {season.toPlant > 0 ? `, ${num(season.toPlant)} bu straight to a plant` : ''}.{' '}
            <button type="button" onClick={() => setShowLoads((o) => !o)} className="underline decoration-dotted">
              {showLoads ? 'Hide the loads' : 'Show the loads'}
            </button>
          </p>
          {showLoads && (
            <table className="mt-2 w-full rounded-md bg-white text-xs">
              <tbody className="divide-y divide-gray-100">
                {season.list.map((l) => (
                  <tr key={l.id}>
                    <td className="px-2 py-1 tabular-nums text-gray-700">{l.loaded_on}</td>
                    <td className="px-2 py-1 text-gray-700">
                      {l.delivery_site_id
                        ? `→ ${(sites ?? []).find((x) => x.id === l.delivery_site_id)?.name ?? 'a plant'}`
                        : ((bins ?? []).find((b) => b.id === l.bin_id)?.name ?? 'a bin')}
                      {l.last_from_field && <Flag className="ml-1 inline h-3 w-3 text-green-700" fill="currentColor" aria-label="Last load" />}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-500">{num(l.net_kg)} kg</td>
                    <td className="px-2 py-1 text-right font-semibold tabular-nums text-gray-900">{num(l.bushels)} bu</td>
                    <td className="px-2 py-1 text-gray-500">{l.driver ?? ''}</td>
                    {canEdit && (
                      <td className="px-1 py-1 text-right">
                        <DeleteLoadButton load={l} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className={cn('mt-0.5 text-xs', season.last ? 'text-green-900/80' : 'text-amber-900/80')}>
            {season.last
              ? `Last load marked on ${season.last.loaded_on}. The yield below is from these loads.`
              : 'The yield is recorded when the last load from this field is marked, on the weigh-in form or here.'}
          </p>
          {canEdit && (
            <div className="mt-2 flex flex-wrap gap-2">
              {!season.last && season.latest && (
                <button
                  type="button"
                  disabled={setLast.isPending}
                  onClick={() => setLast.mutate({ id: season.latest!.id, last: true })}
                  className="flex items-center gap-1.5 rounded-md bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-800 disabled:opacity-50"
                >
                  <Flag className="h-3.5 w-3.5" /> The {season.latest.loaded_on} load was the last — record the yield
                </button>
              )}
              {season.last && (
                <button
                  type="button"
                  disabled={setLast.isPending}
                  onClick={() => setLast.mutate({ id: season.last!.id, last: false })}
                  className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Not done yet — reopen the harvest
                </button>
              )}
            </div>
          )}
          {!thisYear && season.last && <p className="mt-1 text-[11px] text-gray-500">Recording…</p>}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-700">Crop history</h3>
          {canEdit && (
            <AddButton
              label="Add a year"
              onClick={() => {
                add.reset()
                setAdding(true)
              }}
            />
          )}
        </div>
        {history.length ? (
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-1 pr-3 font-medium">Year</th>
                  <th className="py-1 pr-3 font-medium">Crop</th>
                  <th className="py-1 pr-3 text-right font-medium">Acres</th>
                  <th className="py-1 pr-3 text-right font-medium" title="Field-run, before cleaning">Pre-clean / ac</th>
                  <th className="py-1 pr-3 text-right font-medium" title="Field-run, before cleaning">Pre-clean total</th>
                  <th className="py-1 pr-3 text-right font-medium" title="What was left after cleaning">Clean / ac</th>
                  <th className="py-1 pr-3 text-right font-medium" title="What was left after cleaning">Clean total</th>
                  <th className="py-1 font-medium">From</th>
                  {canEdit && <th className="py-1" />}
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const unit = h.yield_unit ?? ''
                  return (
                    <tr key={h.id} className="border-t border-gray-100 align-top">
                      <td className="py-1.5 pr-3">{h.crop_year}</td>
                      <td className="py-1.5 pr-3">
                        {cropName(h.crop_id)}
                        {h.variety && <span className="block text-[11px] text-gray-400">{h.variety}</span>}
                        <TraitBadge t={canolaTrait?.(h.crop_id, h.variety) ?? null} />
                      </td>
                      <td className="py-1.5 pr-3 text-right">{cell(h, 'acres', 'w-20')}</td>
                      <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                        {cell(h, 'yield_per_acre', 'w-20')}
                        {unit && <span className="ml-1 text-xs text-gray-400">{unit}</span>}
                        {h.plan_yield_saved && h.clean_yield_per_acre == null && h.yield_per_acre != null && <PlanMark label="Plan uses this (pre-clean)" amber />}
                      </td>
                      <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                        {cell(h, 'actual_yield_total', 'w-24')}
                        {unit && <span className="ml-1 text-xs text-gray-400">{unit}</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                        {cell(h, 'clean_yield_per_acre', 'w-20')}
                        {h.plan_yield_saved && h.clean_yield_per_acre != null && <PlanMark label="Plan uses this" />}
                      </td>
                      <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                        {cell(h, 'clean_total', 'w-24')}
                        {h.clean_total != null && h.actual_yield_total != null && Number(h.actual_yield_total) > 0 && (
                          <span className="block text-[11px] text-gray-500">
                            {(((Number(h.clean_total) - Number(h.actual_yield_total)) / Number(h.actual_yield_total)) * 100).toFixed(1)}% clean-out
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-xs text-gray-500">
                        {h.yield_override ? (
                          <>
                            <span className="font-medium text-amber-800">Typed over the scale</span>
                            <span className="block text-[11px]">
                              Scale: {num(h.scale_total)} {unit}
                              {h.scale_acres ? `, ${num(Number(h.scale_total) / Number(h.scale_acres), 1)} ${unit}/ac` : ''}
                              {h.scale_wet_total != null ? ` dry (${num(h.scale_wet_total)} as weighed)` : ''}
                            </span>
                            {canEdit && (
                              <button
                                type="button"
                                disabled={resetToScale.isPending}
                                onClick={() => resetToScale.mutate(h.id, { onError: (e) => setError((e as Error).message) })}
                                className="mt-0.5 text-[11px] text-brand-700 underline decoration-dotted"
                              >
                                Use the scale figure
                              </button>
                            )}
                          </>
                        ) : h.source === 'scale' && h.scale_at ? (
                          <>
                            <span className="font-medium text-green-800">Scale</span>
                            <span className="block text-[11px]">{h.scale_loads} loads</span>
                          </>
                        ) : (
                          SOURCE_LABEL[h.source] ?? h.source
                        )}
                      </td>
                      {canEdit && (
                        <td className="whitespace-nowrap py-1.5 pl-2 text-right">
                          {!locked(h.crop_year) && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  editMeta.reset()
                                  setEditing(h)
                                }}
                                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                title="Edit crop, variety and unit"
                                aria-label={`Edit ${h.crop_year}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  remove.reset()
                                  setDeleting(h)
                                }}
                                className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                title="Delete this year's row"
                                aria-label={`Delete ${h.crop_year}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-400">No history yet.</p>
        )}
        {canEdit && history.length > 0 && (
          <HelpNote className="mt-2" summary="Type per-acre or total; the other fills in." title="Entering yields">
            Type the yield per acre or the total and the other follows from the acres, for both the pre-clean (field-run) yield and
            the yield after clean-out. This season's plan, marketing position and bin estimate use the clean yield once it is
            entered, and the pre-clean one, labelled as such, until then. A figure typed over the scale's is kept until
            "Use the scale figure". Past seasons are locked unless a manager unlocks the year.
          </HelpNote>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

      {adding && (
        <RecordEditModal
          title="Add a year to the crop history"
          fields={metaFields(null)}
          row={{ crop_year: history.length ? Math.min(...history.map((h) => h.crop_year)) - 1 : cropYear - 1 }}
          saving={add.isPending}
          error={add.error ? (add.error as Error).message : null}
          onClose={() => setAdding(false)}
          onSave={(p) =>
            add.mutateAsync({
              ...p,
              yield_unit: p.yield_unit ?? crops?.find((c) => c.id === p.crop_id)?.yield_unit ?? null,
            })
          }
        />
      )}

      {editing && (
        <RecordEditModal
          title={`${editing.crop_year}: ${cropName(editing.crop_id)}`}
          fields={metaFields(editing)}
          row={editing}
          saving={editMeta.isPending}
          error={editMeta.error ? (editMeta.error as Error).message : null}
          onClose={() => setEditing(null)}
          onSave={(p) => editMeta.mutateAsync({ id: editing.id, p })}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.crop_year}`}
          message={
            <>
              Delete the {deleting.crop_year} {cropName(deleting.crop_id)} row from this field's history?
              {deleteNeedsPlanRestore(deleting) && ` The ${deleting.crop_year} plan goes back to its estimate.`}
              {deleting.source === 'scale' && ' The scale writes it again if a last load off this field is marked.'}
            </>
          }
          busy={remove.isPending}
          error={remove.error ? (remove.error as Error).message : null}
          onClose={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting)}
        />
      )}
    </div>
  )
}

/**
 * A canola's herbicide trait, so the field's past Liberty and Roundup canola
 * can be read at a glance — what decides which company can use it next.
 */
function TraitBadge({ t }: { t: { trait: HerbicideTrait | null; from: string | null } | null }) {
  if (!t) return null
  if (!t.trait)
    return (
      <span className="mt-0.5 block text-[10px] text-gray-400" title="Set the trait on the company's canola crop (Crops), or record the company in the variety">
        herbicide trait not known
      </span>
    )
  return (
    <span
      className={cn(
        'mt-0.5 inline-block rounded px-1.5 py-px text-[10px] font-semibold',
        t.trait === 'liberty' ? 'bg-sky-100 text-sky-800' : 'bg-orange-100 text-orange-800',
      )}
      title={`${TRAIT_LABEL[t.trait]}${t.from ? ` (from ${t.from})` : ''}`}
    >
      {TRAIT_SHORT[t.trait]}
    </span>
  )
}

function PlanMark({ label, amber = false }: { label: string; amber?: boolean }) {
  return <span className={cn('mt-0.5 block text-[10px] font-medium', amber ? 'text-amber-700' : 'text-green-700')}>{label}</span>
}
