import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Sprout } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type CropRow = Database['public']['Tables']['crops']['Row']

/**
 * Notes for a crop, split by the stage of the year the work falls in.
 *
 * Four columns rather than one free-text blob: what you need at seeding is not
 * what you need at harvest, and a single box turns into a wall nobody reads at
 * the moment they actually need one line out of it.
 */
const SECTIONS = [
  {
    key: 'notes_planting',
    label: 'Planting',
    hint: 'Seeding rates and depth, varieties that did well, fertiliser at seeding, timing.',
  },
  {
    key: 'notes_growing',
    label: 'Growing season',
    hint: 'Spray timing, staging, disease and insect pressure to watch, irrigation.',
  },
  {
    key: 'notes_harvest',
    label: 'Harvest',
    hint: 'When it is ready, moisture to target, swathing or straight cutting, settings.',
  },
  {
    key: 'notes_storage',
    label: 'Storage',
    hint: 'Drying and aeration, safe moisture, how long it keeps, buyer requirements.',
  },
  // The crop page had this as a second notes card of its own. One card, one
  // Save: the free-text box that fits none of the four stages sits under them.
  {
    key: 'cheatsheet_md',
    label: 'Other notes',
    hint: 'Seeding rates, target populations, spray notes, harvest reminders…',
    wide: true,
  },
] as const satisfies readonly { key: keyof CropRow; label: string; hint: string; wide?: boolean }[]

export function CropNotes({ crop, readonly }: { crop: CropRow; readonly: boolean }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(SECTIONS.map((s) => [s.key, (crop[s.key] as string | null) ?? ''])),
  )

  const save = useMutation({
    mutationFn: async () => {
      const patch = Object.fromEntries(
        SECTIONS.map((s) => [s.key, draft[s.key]?.trim() || null]),
      ) as Database['public']['Tables']['crops']['Update']
      const { error } = await supabase.from('crops').update(patch).eq('id', crop.id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['crops'] }),
  })

  const dirty = SECTIONS.some((s) => (draft[s.key] ?? '') !== ((crop[s.key] as string | null) ?? ''))

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <Sprout className="h-4 w-4 text-brand-700" /> Notes and recommendations
        </h3>
        {dirty && !readonly && (
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" /> Save
          </button>
        )}
        {save.isError && (
          <span className="text-xs text-red-600">{(save.error as Error).message}</span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-gray-500">
        Whatever is worth remembering about growing {crop.name} here, kept with the crop rather than
        in someone&apos;s head.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {SECTIONS.map((s) => (
          <label key={s.key} className={'wide' in s && s.wide ? 'flex flex-col lg:col-span-2' : 'flex flex-col'}>
            <span className="text-xs font-medium text-gray-700">{s.label}</span>
            <span className="mt-0.5 text-[11px] text-gray-400">{s.hint}</span>
            <textarea
              value={draft[s.key] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
              disabled={readonly}
              rows={6}
              className="mt-1 w-full rounded-md border border-gray-300 p-2 text-sm text-gray-900 disabled:bg-gray-50"
            />
          </label>
        ))}
      </div>
    </div>
  )
}
