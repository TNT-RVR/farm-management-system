import { useState } from 'react'
import { HelpNote } from '@/components/HelpNote'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Handshake } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { FieldRow } from '@/lib/queries'
import { useCropYear } from '@/lib/crop-year'

/** Re-mark which sprays are ours once tenure changes. */
async function reclassify() {
  await supabase.rpc('jd_reclassify')
}

/**
 * The part of a field somebody else farms.
 *
 * Fields 9 and 10 are cropped in part and rented out in part. The drawn
 * boundary already covers only our side, which is right — every per-acre figure
 * in the app should be about land we actually farm — but nothing said so, and
 * the imported acreage covering the whole field made the boundary look wrong by
 * more than double.
 *
 * Recording the rented acres turns that disagreement into an explanation.
 */
export function FieldTenure({
  field,
  mappedAcres,
  canEdit,
}: {
  field: FieldRow
  mappedAcres: number | null
  canEdit: boolean
}) {
  const queryClient = useQueryClient()
  const [acres, setAcres] = useState(
    field.rented_out_acres == null ? '' : String(field.rented_out_acres),
  )
  const [to, setTo] = useState(field.rented_out_to ?? '')
  const [notes, setNotes] = useState(field.tenure_notes ?? '')
  const [renterCrop, setRenterCrop] = useState(field.rented_out_crop ?? '')
  const { cropYear } = useCropYear()
  const { data: yearRow } = useQuery({
    queryKey: ['field_year_tenure', field.id, cropYear],
    queryFn: async () => {
      const { data, error } = await supabase.from('field_year_tenure').select('*').eq('field_id', field.id).eq('crop_year', cropYear).maybeSingle()
      if (error) throw error
      return data
    },
  })
  const setWhole = useMutation({
    mutationFn: async (v: { on: boolean; to: string }) => {
      const { error } = v.on
        ? await supabase.from('field_year_tenure').upsert({ field_id: field.id, crop_year: cropYear, rented_to: v.to.trim() || null }, { onConflict: 'field_id,crop_year' })
        : await supabase.from('field_year_tenure').delete().eq('field_id', field.id).eq('crop_year', cropYear)
      if (error) throw error
      await reclassify()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['field_year_tenure'] })
      void queryClient.invalidateQueries({ queryKey: ['jd_field_operations'] })
    },
  })
  const [dirty, setDirty] = useState(false)

  const save = useMutation({
    mutationFn: async () => {
      const value = acres.trim() === '' ? null : Number(acres)
      if (value != null && (!Number.isFinite(value) || value < 0))
        throw new Error('Rented-out acres must be a number, or blank.')
      const { error } = await supabase
        .from('fields')
        .update({
          rented_out_acres: value,
          rented_out_to: to.trim() || null,
          tenure_notes: notes.trim() || null,
          rented_out_crop: renterCrop.trim().toLowerCase() || null,
        })
        .eq('id', field.id)
      if (error) throw error
      await reclassify()
    },
    onSuccess: () => {
      setDirty(false)
      void queryClient.invalidateQueries({ queryKey: ['fields'] })
      void queryClient.invalidateQueries({ queryKey: ['jd_field_operations'] })
    },
  })

  const rented = field.rented_out_acres
  const whole = mappedAcres != null && rented != null ? mappedAcres + rented : null

  // Nothing to show and nothing to do: most fields are not split, and an empty
  // panel on every one of them is noise.
  if (!canEdit && rented == null && !yearRow) return null

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <Handshake className="h-4 w-4 text-gray-400" /> Rented out
        </h3>
        {canEdit && dirty && (
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-md bg-brand-700 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>

      {whole != null && rented != null && rented > 0 && (
        <p className="mt-2 text-sm text-gray-700">
          We farm <span className="font-semibold">{mappedAcres?.toFixed(2)} ac</span>
          {rented > 0 && (
            <>
              {' · '}
              {rented.toFixed(2)} ac rented out
              {field.rented_out_to ? ` to ${field.rented_out_to}` : ''}
              {' · '}
              whole field {whole.toFixed(2)} ac
            </>
          )}
        </p>
      )}

      {canEdit ? (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-xs text-gray-500">
            Acres rented out
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={acres}
              onChange={(e) => {
                setAcres(e.target.value)
                setDirty(true)
              }}
              placeholder="—"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="text-xs text-gray-500">
            Rented to
            <input
              value={to}
              onChange={(e) => {
                setTo(e.target.value)
                setDirty(true)
              }}
              placeholder="—"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-gray-500">
            Renter&apos;s crop
            <input
              value={renterCrop}
              onChange={(e) => {
                setRenterCrop(e.target.value)
                setDirty(true)
              }}
              placeholder="e.g. potato, carrot"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
            <span className="mt-0.5 block text-[10px] text-gray-400">Sprays Deere tags with this crop are theirs, not our cost.</span>
          </label>
          <label className="text-xs text-gray-500">
            Notes
            <input
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value)
                setDirty(true)
              }}
              placeholder="Which part, since when, anything worth remembering"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
        </div>
      ) : (
        field.tenure_notes && <p className="mt-1 text-xs text-gray-500">{field.tenure_notes}</p>
      )}

      <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!yearRow}
            disabled={!canEdit || setWhole.isPending}
            onChange={(e) => setWhole.mutate({ on: e.target.checked, to: yearRow?.rented_to ?? '' })}
          />
          <span>
            Whole field rented out in <b>{cropYear}</b>
            {yearRow?.rented_to ? ` to ${yearRow.rented_to}` : ''}
          </span>
        </label>
        <p className="mt-0.5 text-[11px] text-gray-500">
          Sprays recorded on it that year stay on its history for the rotation, but are not counted as our cost.
        </p>
      </div>

      <HelpNote className="mt-2" summary="Per-acre figures use our part of the field only." title="Why record the rest">
        The boundary covers our part only, and that is what every per-acre figure uses. This records
        the rest so the mapped acres and the imported acreage stop looking like a mistake.
      </HelpNote>

      {save.isError && <p className="mt-1 text-xs text-red-600">{(save.error as Error).message}</p>}
    </div>
  )
}
