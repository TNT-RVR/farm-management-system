import { useState } from 'react'
import { HelpNote } from '@/components/HelpNote'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'

/**
 * Which crops count toward seeding and harvest progress.
 *
 * The exemptions are a business arrangement, not a fact about the plant, so
 * they have to be changeable by the farm rather than hard-coded by me. The
 * potatoes are the case that makes it obvious: they are planted every year,
 * just not by us, and the crop-share deal could end any spring.
 *
 * It lives on the progress screen rather than in Settings because this is where
 * somebody notices the number looks wrong, and a fix three menus away is a fix
 * nobody makes.
 */

type CropRow = {
  id: string
  name: string
  counts_for_seeding: boolean
  counts_for_harvest: boolean
  progress_note: string | null
}

function useProgressCrops() {
  return useQuery({
    queryKey: ['crops_progress_flags'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crops')
        .select('id, name, counts_for_seeding, counts_for_harvest, progress_note')
        .eq('active', true)
        .order('name')
      if (error) throw error
      return (data ?? []) as unknown as CropRow[]
    },
  })
}

export function CropProgressExemptions({ canEdit }: { canEdit: boolean }) {
  const { data: crops, isLoading } = useProgressCrops()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  const save = useMutation({
    mutationFn: async (patch: { id: string } & Partial<CropRow>) => {
      const { id, ...fields } = patch
      const { error } = await supabase.from('crops').update(fields).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crops_progress_flags'] })
      // The percentages are computed from these, so they have to be refetched
      // or the screen keeps showing the old target until a reload.
      void qc.invalidateQueries({ queryKey: ['field_season_progress'] })
    },
  })

  const exempt = (crops ?? []).filter((c) => !c.counts_for_seeding || !c.counts_for_harvest)

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Which crops count
        </span>
        <span className="text-xs text-gray-500">
          {exempt.length
            ? `${exempt.length} exempt: ${exempt.map((c) => c.name).join(', ')}`
            : 'every crop counted'}
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-3">
          <HelpNote className="mb-2 text-xs" summary="Untick a crop to take its acres out of that target." title="Seeding and harvest are separate">
            Untick a crop to take its acres out of that target. The two are separate on purpose:
            alfalfa is not seeded by us but is cut by us, while the crop-shared potatoes are
            neither planted nor harvested by us.
          </HelpNote>

          {isLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="py-1 font-medium">Crop</th>
                  <th className="w-20 py-1 text-center font-medium">We seed</th>
                  <th className="w-24 py-1 text-center font-medium">We harvest</th>
                  <th className="py-1 pl-3 font-medium">Why not</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(crops ?? []).map((c) => (
                  <tr key={c.id}>
                    <td className="py-1.5 text-gray-900">{c.name}</td>
                    <td className="py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={c.counts_for_seeding}
                        disabled={!canEdit || save.isPending}
                        aria-label={`We seed ${c.name}`}
                        onChange={(e) =>
                          save.mutate({ id: c.id, counts_for_seeding: e.target.checked })
                        }
                        className="h-4 w-4 rounded border-gray-300"
                      />
                    </td>
                    <td className="py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={c.counts_for_harvest}
                        disabled={!canEdit || save.isPending}
                        aria-label={`We harvest ${c.name}`}
                        onChange={(e) =>
                          save.mutate({ id: c.id, counts_for_harvest: e.target.checked })
                        }
                        className="h-4 w-4 rounded border-gray-300"
                      />
                    </td>
                    <td className="py-1.5 pl-3">
                      {c.counts_for_seeding && c.counts_for_harvest ? (
                        <span className="text-gray-300">—</span>
                      ) : (
                        <input
                          defaultValue={c.progress_note ?? ''}
                          disabled={!canEdit}
                          placeholder="Why is it exempt?"
                          aria-label={`Why ${c.name} is exempt`}
                          onBlur={(e) => {
                            const v = e.target.value.trim()
                            if (v !== (c.progress_note ?? ''))
                              save.mutate({ id: c.id, progress_note: v || null })
                          }}
                          className="w-full rounded-md border border-gray-200 px-2 py-1 text-xs"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {save.isError && (
            <p className="mt-2 text-xs text-red-600">{(save.error as Error).message}</p>
          )}
          {!canEdit && (
            <p className="mt-2 text-xs text-gray-400">Only a manager can change these.</p>
          )}
        </div>
      )}
    </div>
  )
}
