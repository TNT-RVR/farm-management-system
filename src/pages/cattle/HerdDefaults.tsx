import { Beef } from 'lucide-react'
import { Select } from '@/components/Select'
import { hasAdminAccess, useAuth } from '@/lib/auth'
import { useFarmSettings, useSaveFarmSetup } from '@/lib/farm-setup'
import { useRanches } from '@/lib/ranches'
import { CARD_HEAD } from '@/lib/table-style'
import { cn } from '@/lib/utils'

/**
 * The two farm-wide cattle answers: which ranch is meant when only one fits,
 * and what breed the herd is.
 *
 * They were on Farm setup under "Names and defaults", among the retailer and
 * the irrigation district, where nobody looking after cattle would think to
 * find them (Sam, 30 Oct 2026). They are cattle questions, so they live on
 * Cattle settings beside the ranches they are about. Still stored on the farm
 * setup row — the whole app reads them from there — so moving the boxes
 * changed no data.
 */
export function HerdDefaults() {
  const { profile } = useAuth()
  const canEdit = hasAdminAccess(profile?.role)
  const farm = useFarmSettings()
  const { data: ranches } = useRanches()
  const save = useSaveFarmSetup()

  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <h2 className={cn('flex items-center gap-1.5 font-medium', CARD_HEAD)}>
        <Beef className="h-4 w-4 text-brand-100" /> Herd defaults
      </h2>
      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-gray-600">
          Main ranch <span className="text-gray-400">(used where only one fits)</span>
          <span className="mt-0.5 block">
            <Select
              size="sm"
              disabled={!canEdit}
              value={farm.mainRanchId ?? ''}
              onChange={(id) => save.mutate({ main_ranch_id: id || null })}
              options={[
                { value: '', label: 'The first ranch' },
                ...(ranches ?? []).map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
          </span>
        </label>
        <label key={farm.cattleBreed} className="text-xs text-gray-600">
          Cattle breed
          <span className="mt-0.5 block">
            <input
              disabled={!canEdit}
              defaultValue={farm.cattleBreed}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v !== farm.cattleBreed) save.mutate({ cattle_breed: v || null })
              }}
              className="w-full rounded-md border border-gray-200 px-1.5 py-1 text-sm disabled:border-transparent disabled:bg-transparent"
            />
          </span>
          <span className="mt-0.5 block text-[11px] text-gray-400">
            Sets the gestation length the due dates are counted on.
          </span>
        </label>
      </div>
    </section>
  )
}
