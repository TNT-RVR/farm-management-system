import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Select } from '@/components/Select'
import { supabase } from '@/lib/supabase'
import { useCropPlans, useCropVarieties, useCrops } from '@/lib/queries'
import { cropColour } from '@/lib/crop-colour'

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
 * the point; here the point is one field.
 */
export function FieldCropCard({
  fieldId,
  cropYear,
  boundaryAcres,
  canEdit,
}: {
  fieldId: string
  cropYear: number
  /** Acres from the boundary, used when a plan is created from scratch. */
  boundaryAcres: number | null
  canEdit: boolean
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
        },
        { onConflict: 'crop_year,field_id' },
      )
      if (error) throw error
      invalidate()
    },
  })

  const varieties = (allVarieties ?? []).filter((v) => v.crop_id === crop?.id)

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
        <Link
          to={`/plan?tab=plan&crop=${plan?.crop_id ?? ''}`}
          className="text-xs text-brand-700 hover:underline"
        >
          Yield and budget →
        </Link>
      </div>

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
