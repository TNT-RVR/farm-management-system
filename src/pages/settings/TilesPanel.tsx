import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, LayoutGrid } from 'lucide-react'
import { Select } from '@/components/Select'
import { HelpNote } from '@/components/HelpNote'
import { useAuth } from '@/lib/auth'
import { TILE_GROUPS, useSaveTilePrefs, useTiles, type Tile } from '@/lib/tiles'

/**
 * Choosing what sits on the home screen.
 *
 * A list of switches rather than a drag-and-drop canvas. The sidebar has the
 * drag version and it is the right call there, where reordering seventeen
 * sections is the whole job; here the question is almost always "is this one on
 * or off", and dragging on a phone to answer a yes/no question is a worse
 * answer than a tap. Order is adjusted with two small arrows for the few times
 * it matters.
 */
export function TilesPanel() {
  const { profile } = useAuth()
  const { visible, hidden } = useTiles()
  const save = useSaveTilePrefs()

  const commit = (next: Tile[], off: Tile[]) =>
    save.mutate({
      order: [...next, ...off].map((t) => t.key),
      hidden: off.map((t) => t.key),
    })

  const turnOn = (t: Tile) =>
    commit(
      [...visible, t],
      hidden.filter((h) => h.key !== t.key),
    )
  const turnOff = (t: Tile) =>
    commit(
      visible.filter((v) => v.key !== t.key),
      [...hidden, t],
    )

  // One section at a time, chosen from a list, rather than the whole catalogue
  // laid out at once. Thirty-odd chips under seven headings is not something
  // anybody reads; picking the view you were thinking of and ticking what you
  // want from it is the question people actually arrive with.
  const [group, setGroup] = useState<(typeof TILE_GROUPS)[number]>(TILE_GROUPS[0])
  const onKeys = useMemo(() => new Set(visible.map((t) => t.key)), [visible])
  const inGroup = useMemo(
    () =>
      [...visible, ...hidden]
        .filter((t) => t.group === group)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [visible, hidden, group],
  )

  const move = (i: number, by: number) => {
    const next = [...visible]
    const j = i + by
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next, hidden)
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <LayoutGrid className="h-4 w-4 text-gray-400" /> Home screen shortcuts
      </h3>
      <HelpNote
        className="mt-1 text-xs"
        title="Home screen shortcuts"
        summary="The tiles on your home screen, in order. Yours only."
      >
        <p>
          The tiles on the app's home screen, in order. Yours only — everyone picks their own, and
          the man on the pivots and the man on the books want almost none of the same ones.
        </p>
      </HelpNote>

      <div className="mt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          On your home screen ({visible.length})
        </p>
        {visible.length === 0 ? (
          <p className="mt-1 text-xs text-gray-400">None yet — add some from below.</p>
        ) : (
          <ul className="mt-1 divide-y divide-gray-100 rounded-md border border-gray-200">
            {visible.map((t, i) => {
              const Icon = t.icon
              return (
                <li key={t.key} className="flex items-center gap-2 px-2 py-1.5">
                  <Icon className="h-4 w-4 shrink-0 text-brand-700" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-900">{t.label}</span>
                    <span className="block truncate text-[11px] text-gray-400">{t.hint}</span>
                  </span>
                  <button
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${t.label} up`}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === visible.length - 1}
                    aria-label={`Move ${t.label} down`}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => turnOff(t)}
                    className="shrink-0 rounded border border-gray-300 px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Remove
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Add from a section
          <Select
            value={group}
            ariaLabel="Section"
            className="mt-1 max-w-xs"
            onChange={(g) => setGroup(g as (typeof TILE_GROUPS)[number])}
            options={TILE_GROUPS.map((g) => {
              const total = [...visible, ...hidden].filter((t) => t.group === g).length
              const on = visible.filter((t) => t.group === g).length
              return { value: g, label: `${g} — ${on} of ${total} on` }
            })}
          />
        </label>

        {inGroup.length === 0 ? (
          <p className="mt-2 text-xs text-gray-400">Nothing in this section.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100 rounded-md border border-gray-200">
            {inGroup.map((t) => {
              const Icon = t.icon
              const on = onKeys.has(t.key)
              return (
                <li key={t.key}>
                  {/* The whole row is the control. A checkbox alone is a small
                      target on a phone in a truck. */}
                  <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => (on ? turnOff(t) : turnOn(t))}
                      className="h-4 w-4 shrink-0 rounded border-gray-300"
                    />
                    <Icon className="h-4 w-4 shrink-0 text-gray-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-gray-900">{t.label}</span>
                      <span className="block truncate text-[11px] text-gray-400">{t.hint}</span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {save.isError && (
        <p className="mt-2 text-[11px] text-red-700">{(save.error as Error).message}</p>
      )}
      {profile?.denied_views?.length ? (
        <p className="mt-3 border-t border-gray-100 pt-2 text-[11px] text-gray-400">
          Sections an administrator has turned off for you are not listed here.
        </p>
      ) : null}
    </section>
  )
}
