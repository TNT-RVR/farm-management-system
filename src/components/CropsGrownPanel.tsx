import { Sprout } from 'lucide-react'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { useCrops, type CropRow } from '@/lib/queries'
import { useSetCropGrown } from '@/lib/rotation-plan'
import { cn } from '@/lib/utils'

/**
 * Which crops are still on the list the planner offers.
 *
 * We stopped growing durum and rye (Sam, 28 Oct 2026) and they were still in
 * every crop menu, so a four-year plan could be built out of crops nobody
 * intends to seed. Unticking one takes it out of the menus and nothing else:
 * crops.active is read when a list is offered, never when history is read.
 *
 * Retired crops are kept in a fold rather than dropped off the screen, because
 * the other half of the job is bringing one back the year we grow it again.
 */
export function CropsGrownPanel({ isManager }: { isManager: boolean }) {
  const { data: crops, isLoading } = useCrops()
  const setGrown = useSetCropGrown()

  // useCrops reads crops.* with no filter, so the retired ones are here too.
  const rows = crops ?? []
  const grown = rows.filter((c) => c.active)
  const retired = rows.filter((c) => !c.active)

  const tick = (c: CropRow) => (
    <label
      key={c.id}
      className={cn(
        'flex min-h-9 items-center gap-2 rounded-md px-1 py-1 text-sm',
        isManager ? 'cursor-pointer hover:bg-gray-50' : 'cursor-default',
      )}
    >
      <input
        type="checkbox"
        checked={c.active}
        disabled={!isManager || setGrown.isPending}
        aria-label={`We still grow ${c.name}`}
        onChange={(e) => setGrown.mutate({ id: c.id, active: e.target.checked })}
        className="h-4 w-4 shrink-0 rounded border-gray-300"
      />
      <span className={cn('min-w-0 truncate', c.active ? 'text-gray-900' : 'text-gray-500')}>{c.name}</span>
    </label>
  )

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <Sprout className="h-4 w-4 text-gray-400" /> Crops we grow
        </h3>
        <span className="text-xs text-gray-500">{grown.length} on the list</span>
      </div>

      <HelpNote
        className="mt-1"
        summary="Unticking a crop only takes it out of the lists you pick from."
        title="Retiring a crop"
      >
        <p>
          Every record keeps its crop name, its return interval and its succession rules. A field that
          grew durum in 2024 still reads “Durum Wheat”, and durum still blocks durum on it in 2025.
        </p>
        <p>
          So nothing is lost and nothing is rewritten: the crop simply stops being offered when you
          plan a field, build a budget or set an acre limit. Tick it again the year we grow it.
        </p>
      </HelpNote>

      {isLoading ? (
        <p className="mt-2 text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="mt-2 grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
          {grown.map(tick)}
        </div>
      )}

      {retired.length > 0 && (
        <Fold
          className="mt-3 border-dashed"
          storageKey="crops-retired"
          title={<span className="font-medium text-gray-600">Not grown any more</span>}
          summary={retired.map((c) => c.name).join(', ')}
        >
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">{retired.map(tick)}</div>
        </Fold>
      )}

      {setGrown.isError && <p className="mt-2 text-xs text-red-600">{(setGrown.error as Error).message}</p>}
      {!isManager && <p className="mt-2 text-xs text-gray-400">Only a manager can change this.</p>}
    </section>
  )
}
