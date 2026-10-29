import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Select } from '@/components/Select'
import { supabase } from '@/lib/supabase'
import { useCropPlans, useCropVarieties, useCrops } from '@/lib/queries'
import { cropColour } from '@/lib/crop-colour'
import { useFieldCropZones } from '@/lib/cropZones'
import { useFieldAreaYields, type CropAreaYield } from '@/lib/cropAreaYields'
import { AreaYieldEditor } from '@/components/AreaYieldEditor'
import { YieldCuts } from '@/components/YieldCuts'
import { YieldScorecard } from '@/components/YieldScorecard'

/**
 * What is going on this field this year.
 *
 * The same crop_plans row the Financials plan edits, offered where somebody
 * actually looks for it. "Which crop is on this field" is a question about the
 * field, and answering it only on a table called Financials — behind a tab,
 * among revenue and cost per acre — meant people could not find it at all.
 *
 * Deliberately just the crop, the variety and the acres. Yield overrides,
 * budgets and the rest stay on the plan, where comparing fields side by side is
 * the point; here the point is one field. The exception is a cut to the
 * estimate for hail or disease (YieldCuts), which is a fact about this field,
 * and the field's goal, estimate and actual (YieldScorecard).
 */
export function FieldCropCard({
  fieldId,
  cropYear,
  boundaryAcres,
  canEdit,
  canRecord = canEdit,
}: {
  fieldId: string
  cropYear: number
  /** Acres from the boundary, used when a plan is created from scratch. */
  boundaryAcres: number | null
  canEdit: boolean
  /**
   * May enter this year's yields and goal. Defaults to canEdit; a crop-share
   * partner may in his own years only, without the plan's other controls.
   */
  canRecord?: boolean
}) {
  const { data: crops } = useCrops()
  const { data: plans } = useCropPlans(cropYear)
  const { data: allVarieties } = useCropVarieties()
  const queryClient = useQueryClient()
  const plan = plans?.find((p) => p.field_id === fieldId) ?? null
  const crop = crops?.find((c) => c.id === plan?.crop_id) ?? null

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['crop_plans'] })
  }

  const save = useMutation({
    mutationFn: async (patch: {
      crop_id?: string
      variety?: string | null
      acres?: number | null
    }) => {
      // Clearing the crop removes the plan rather than leaving a row with no
      // crop in it, which is what the plan table does and what every reader of
      // crop_plans already expects.
      if (patch.crop_id === '') {
        if (plan) {
          const { error } = await supabase.from('crop_plans').delete().eq('id', plan.id)
          if (error) throw error
        }
        invalidate()
        return
      }
      const cropId = patch.crop_id ?? plan?.crop_id
      if (!cropId) return
      const { error } = await supabase.from('crop_plans').upsert(
        {
          crop_year: cropYear,
          field_id: fieldId,
          crop_id: cropId,
          variety: patch.variety !== undefined ? patch.variety : (plan?.variety ?? null),
          planned_acres:
            patch.acres !== undefined ? patch.acres : (plan?.planned_acres ?? boundaryAcres),
          // A different crop makes the old yield override meaningless — 180
          // bu/ac of corn is not 180 bu/ac of anything else.
          yield_per_acre_override:
            patch.crop_id && patch.crop_id !== plan?.crop_id
              ? null
              : (plan?.yield_per_acre_override ?? null),
          // The same for a typed range.
          ...(patch.crop_id && patch.crop_id !== plan?.crop_id && (plan?.yield_low != null || plan?.yield_high != null)
            ? { yield_low: null, yield_high: null }
            : {}),
        },
        { onConflict: 'crop_year,field_id' },
      )
      if (error) throw error
      invalidate()
    },
  })

  const varieties = (allVarieties ?? []).filter((v) => v.crop_id === crop?.id)
  // A field split into several crops this year (drawn on the map).
  const { data: zones } = useFieldCropZones(fieldId, cropYear)
  const splitLink = `/map?field=${fieldId}&split=1`
  // Each crop area's yield: the scale loads of that crop over its own acres,
  // or a manager's figure. Two areas of one crop share one yield.
  const { data: areaYields } = useFieldAreaYields(zones?.length ? fieldId : null, cropYear)
  const [editing, setEditing] = useState<{ cropId: string; row: CropAreaYield | null } | null>(null)
  const areaAcres = (cropId: string) => (zones ?? []).filter((z) => z.crop_id === cropId).reduce((t, z) => t + Number(z.acres ?? 0), 0) || null

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          {crop && (
            <span
              className="h-3 w-3 shrink-0 rounded-full border border-black/10"
              style={{ background: cropColour(crop) }}
            />
          )}
          {cropYear} crop
        </h3>
        <span className="flex items-baseline gap-3">
          {canEdit && !zones?.length && (
            <Link to={splitLink} className="text-xs text-brand-700 hover:underline">
              Split crops →
            </Link>
          )}
          {/* The farm's plan and budget; not a partner's (canEdit is managers). */}
          {canEdit && (
            <Link
              to={`/plan?tab=plan&crop=${plan?.crop_id ?? ''}`}
              className="text-xs text-brand-700 hover:underline"
            >
              Yield and budget →
            </Link>
          )}
        </span>
      </div>

      {zones && zones.length > 0 && (
        <div className="mt-3 rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-gray-500">
              Split into {zones.length} crop areas
            </span>
            {canEdit && (
              <Link to={splitLink} className="text-xs text-brand-700 hover:underline">
                Edit on map →
              </Link>
            )}
          </div>
          <ul className="mt-1 space-y-0.5">
            {zones.map((z) => {
              const zc = crops?.find((c) => c.id === z.crop_id)
              return (
                <li key={z.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2 text-gray-900">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
                      style={{ background: cropColour(zc) }}
                    />
                    {zc?.name ?? 'Unknown crop'}
                  </span>
                  <span className="flex items-baseline gap-3 tabular-nums text-gray-600">
                    {(() => {
                      const y = areaYields?.find((a) => a.crop_id === z.crop_id) ?? null
                      const label = y?.yield_per_acre != null ? `${y.yield_per_acre} ${y.yield_unit ?? zc?.yield_unit ?? ''}/ac` : null
                      return canRecord ? (
                        <button
                          type="button"
                          onClick={() => setEditing({ cropId: z.crop_id, row: y })}
                          className="text-xs text-brand-700 hover:underline"
                          title={y ? (y.yield_override ? 'Typed in' : `From ${y.scale_loads ?? 0} scale loads`) : 'Enter the yield'}
                        >
                          {label ?? 'Add yield'}
                        </button>
                      ) : (
                        label && <span className="text-xs">{label}</span>
                      )
                    })()}
                    {z.acres != null ? `${Number(z.acres).toFixed(1)} ac` : '—'}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <YieldCuts
        fieldId={fieldId}
        cropYear={cropYear}
        canEdit={canEdit}
        planCropId={plan?.crop_id ?? null}
        zones={zones ?? []}
        crops={crops ?? []}
      />
      <YieldScorecard fieldId={fieldId} cropYear={cropYear} canEdit={canRecord} plan={plan} crops={crops ?? []} zones={zones ?? []} />
      {editing && (
        <AreaYieldEditor
          fieldId={fieldId}
          cropYear={cropYear}
          cropId={editing.cropId}
          cropName={crops?.find((c) => c.id === editing.cropId)?.name ?? 'Crop'}
          unit={crops?.find((c) => c.id === editing.cropId)?.yield_unit ?? null}
          acres={areaAcres(editing.cropId)}
          row={editing.row}
          onClose={() => setEditing(null)}
        />
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-gray-500">
          Crop
          <Select
            disabled={!canEdit}
            value={plan?.crop_id ?? ''}
            ariaLabel={`Crop for ${cropYear}`}
            className="mt-1"
            onChange={(v) => save.mutate({ crop_id: v })}
            options={[
              { value: '', label: '— none —' },
              ...(crops ?? [])
                .filter((c) => c.active || c.id === plan?.crop_id)
                .map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </label>

        <label className="text-xs font-medium text-gray-500">
          Variety
          {varieties.length > 0 ? (
            <Select
              disabled={!canEdit || !plan}
              value={plan?.variety ?? ''}
              ariaLabel="Variety"
              className="mt-1"
              onChange={(v) => save.mutate({ variety: v || null })}
              options={[
                { value: '', label: '—' },
                ...varieties.map((v) => ({ value: v.name, label: v.name })),
              ]}
            />
          ) : (
            <input
              disabled={!canEdit || !plan}
              defaultValue={plan?.variety ?? ''}
              key={`${plan?.id}-${plan?.variety ?? ''}`}
              placeholder="—"
              onBlur={(e) => {
                const v = e.target.value.trim() || null
                if (v !== (plan?.variety ?? null)) save.mutate({ variety: v })
              }}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50"
            />
          )}
        </label>

        <label className="text-xs font-medium text-gray-500">
          Planned acres
          <input
            type="number"
            disabled={!canEdit || !plan}
            key={`${plan?.id}-${plan?.planned_acres ?? ''}`}
            defaultValue={plan?.planned_acres ?? ''}
            placeholder={boundaryAcres != null ? boundaryAcres.toFixed(1) : '—'}
            onBlur={(e) => {
              const v = e.target.value === '' ? null : Number(e.target.value)
              if (v !== (plan?.planned_acres ?? null)) save.mutate({ acres: v })
            }}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-right text-sm tabular-nums text-gray-900 disabled:bg-gray-50"
          />
        </label>
      </div>

      {!plan && (
        <p className="mt-2 text-xs text-gray-500">
          Nothing planned on this field for {cropYear}. Pick a crop and the rest fills in from the
          boundary.
        </p>
      )}
      {save.error && <p className="mt-2 text-xs text-red-700">{(save.error as Error).message}</p>}
    </div>
  )
}
