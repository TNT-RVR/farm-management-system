import { useMemo } from 'react'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import { LIMIT_GROUPS, groupOf, type CropInfo } from '@/lib/rotation-engine'
import { useSetCropPriority, type LimitGroup } from '@/lib/rotation-context'

/**
 * Which crop gets the fields first (Sam, 12 Nov 2026).
 *
 * "Rank each crop in order of priority so seed canola fills fields first up
 * to its max, then potatoes, then beans, then corn." The recommender used to
 * hand every field to whichever crop scored highest on it, which is the right
 * answer to a different question: the farm has contracts and a seed canola
 * licence that have to be covered on the ground they suit, and the rest of
 * the rotation fits around them.
 *
 * A list rather than a column of numbers in the limits table, because a rank
 * only means anything beside the others — "potatoes above beans" is the thing
 * being said, and a box holding "2" is not.
 */

type Entry = { key: string; label: string; cropId?: string; group?: LimitGroup; max: number | null }

export function CropPriority({
  crops,
  limits,
  isManager,
}: {
  crops: CropInfo[]
  limits: { crop_id: string | null; crop_group: string | null; crop_year: number | null; max_acres: number | null; priority: number | null }[]
  isManager: boolean
}) {
  const setPriority = useSetCropPriority()

  /** Everything that can be ranked: the combined groups, then the crops not inside one. */
  const all = useMemo<Entry[]>(() => {
    const everyYear = (match: (l: (typeof limits)[number]) => boolean) => limits.find((l) => match(l) && l.crop_year == null)
    const grouped = new Set<string>(LIMIT_GROUPS.map((g) => g.group))
    const groups: Entry[] = LIMIT_GROUPS.map((g) => {
      const row = everyYear((l) => l.crop_group === g.group)
      return { key: `group:${g.group}`, label: g.label, group: g.group, max: row?.max_acres == null ? null : Number(row.max_acres) }
    })
    const singles: Entry[] = crops
      .filter((c) => !c.renterOnly && !grouped.has(groupOf(c.key)))
      .map((c) => {
        const row = everyYear((l) => l.crop_id === c.id)
        return { key: `crop:${c.id}`, label: c.name, cropId: c.id, max: row?.max_acres == null ? null : Number(row.max_acres) }
      })
    return [...groups, ...singles]
  }, [crops, limits])

  /** The running order on file, and what rank each thing has. */
  const { ranked, rest } = useMemo(() => {
    const rankOf = (e: Entry) => {
      const row = limits.find((l) => l.crop_year == null && (e.cropId ? l.crop_id === e.cropId : l.crop_group === e.group))
      return row?.priority == null ? null : Number(row.priority)
    }
    const withRank = all.map((e) => ({ e, rank: rankOf(e) }))
    return {
      ranked: withRank.filter((x) => x.rank != null).sort((a, b) => a.rank! - b.rank!).map((x) => x.e),
      rest: withRank.filter((x) => x.rank == null).map((x) => x.e).sort((a, b) => a.label.localeCompare(b.label)),
    }
  }, [all, limits])

  /**
   * Renter's crops nobody has ranked.
   *
   * They are the grower's to plant on our ground, so the recommender leaves
   * them alone — until the farm ranks one, which places it. Saying which are
   * still sitting out is better than a list that quietly has no potatoes in
   * it when potatoes are the second crop anybody names.
   */
  const renters = useMemo(() => {
    const placed = new Set(ranked.flatMap((e) => (e.cropId ? [e.cropId] : crops.filter((c) => groupOf(c.key) === e.group).map((c) => c.id))))
    return crops.filter((c) => c.renterOnly && !placed.has(c.id)).map((c) => c.name).sort()
  }, [crops, ranked])

  const save = (next: Entry[], cleared: Entry[] = []) =>
    setPriority.mutate({
      order: next.map((e) => (e.cropId ? { cropId: e.cropId } : { group: e.group })),
      clear: cleared.map((e) => (e.cropId ? { cropId: e.cropId } : { group: e.group })),
    })

  const move = (at: number, by: number) => {
    const next = [...ranked]
    const to = at + by
    if (to < 0 || to >= next.length) return
    ;[next[at], next[to]] = [next[to], next[at]]
    save(next)
  }

  return (
    <details className="rounded-md border border-gray-200 bg-white p-2">
      <summary className="cursor-pointer text-xs font-semibold text-gray-800">
        Which crop gets the fields first
        {ranked.length > 0 && <span className="ml-1.5 font-normal text-gray-500">{ranked.map((e) => e.label).join(' → ')}</span>}
      </summary>
      <HelpNote className="mt-1" summary="Ranked crops are dealt their best fields first, up to their acre limit.">
        Each crop in this list takes the fields it scores best on until it reaches its acre limit, in the order shown,
        and the rest of the farm is dealt out by score afterwards as before. A crop with no limit set still stops at
        the usual one-crop share of the farm. Nothing here overrules a rule: a crop the rotation blocks on a field, or
        that a seed company failed, is never placed there whatever its rank. Water can still step a ranked crop down
        to a lighter one if its licence runs short, and the plan says so on that field.
      </HelpNote>

      {ranked.length === 0 ? (
        <p className="mt-2 text-xs text-gray-500">No crop is ranked, so every field goes to whichever crop fits it best.</p>
      ) : (
        <ol className="mt-2 space-y-1">
          {ranked.map((e, at) => (
            <li key={e.key} className="flex items-center gap-2 rounded border border-gray-200 px-2 py-1">
              <span className="w-4 shrink-0 text-xs font-semibold tabular-nums text-gray-500">{at + 1}</span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-800">{e.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-gray-500">
                {e.max == null ? 'no limit' : `up to ${Math.round(e.max).toLocaleString('en-CA')} ac`}
              </span>
              {isManager && (
                <span className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => move(at, -1)}
                    disabled={at === 0 || setPriority.isPending}
                    className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                    aria-label={`Move ${e.label} up`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(at, 1)}
                    disabled={at === ranked.length - 1 || setPriority.isPending}
                    className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                    aria-label={`Move ${e.label} down`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => save(ranked.filter((x) => x.key !== e.key), [e])}
                    disabled={setPriority.isPending}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-700 disabled:opacity-30"
                    aria-label={`Take ${e.label} off the list`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {renters.length > 0 && (
        <p className="mt-2 text-xs text-gray-500" title={renters.join(', ')}>
          {renters.length} renter&apos;s crop{renters.length === 1 ? '' : 's'} sit{renters.length === 1 ? 's' : ''} out — the
          recommender never places one until it is ranked.
        </p>
      )}

      {isManager && rest.length > 0 && (
        <label className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
          Add a crop
          <select
            value=""
            disabled={setPriority.isPending}
            onChange={(e) => {
              const add = rest.find((x) => x.key === e.target.value)
              if (add) save([...ranked, add])
            }}
            className="rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-900"
          >
            <option value="">choose…</option>
            {rest.map((e) => (
              <option key={e.key} value={e.key}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </details>
  )
}
