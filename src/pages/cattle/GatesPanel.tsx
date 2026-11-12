import { useState } from 'react'
import { DoorClosed, DoorOpen } from 'lucide-react'
import { usePastureGates, useGateOpenMutations } from '@/lib/grazing-plan-data'
import { usePastures } from '@/lib/pastures'
import { pastureLabel } from '@/lib/pastureLabel'
import { Fold } from '@/components/Fold'
import { cn } from '@/lib/utils'

/**
 * The gates, open or shut.
 *
 * A gate's state is not a note to yourself: an open gate carries the
 * neighbouring paddock's water through it, so every toggle here redraws the
 * distance-from-water shading. That is the whole reason the control exists on
 * the map rather than in a settings page.
 *
 * Folded, because 27 gates is a list nobody wants in the way daily.
 */
function pairName(pastures: { id: string; name: string }[] | undefined, id: string): string {
  const p = pastures?.find((x) => x.id === id)
  if (!p) return '?'
  const l = pastureLabel(p.name)
  return l ? l.text.split(String.fromCharCode(10)).join(' ') : p.name
}

export function GatesPanel({ ranchId, canEdit }: { ranchId?: string; canEdit: boolean }) {
  const { data: gates } = usePastureGates()
  const { data: pastures } = usePastures()
  const { setOne, setAll } = useGateOpenMutations()
  const [note, setNote] = useState('')

  const mine = (gates ?? [])
    .map((g) => ({
      ...g,
      a: pairName(pastures, g.pasture_a),
      b: pairName(pastures, g.pasture_b),
    }))
    .sort((x, y) => (x.a + x.b).localeCompare(y.a + y.b))

  if (!mine.length) return null
  const open = mine.filter((g) => g.is_open).length
  const busy = setAll.isPending || setOne.isPending

  const all = (want: boolean) =>
    setAll.mutate(
      { open: want, ranchId: ranchId || null },
      {
        onSuccess: (n) => {
          setNote(n === 0 ? `Every gate was already ${want ? 'open' : 'shut'}.` : `${n} gate${n === 1 ? '' : 's'} ${want ? 'opened' : 'shut'}.`)
          setTimeout(() => setNote(''), 4000)
        },
      },
    )

  return (
    <div className="min-w-[12rem]">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Gates</p>
      <p className="mt-1 text-[11px] text-gray-500">
        {open} of {mine.length} open. An open gate lets the water next door count.
      </p>
      {canEdit && (
        <div className="mt-1.5 flex gap-1">
          <button
            onClick={() => all(true)}
            disabled={busy}
            className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Open all
          </button>
          <button
            onClick={() => all(false)}
            disabled={busy}
            className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Shut all
          </button>
        </div>
      )}
      {note && <p className="mt-1 text-[11px] font-medium text-brand-700">{note}</p>}
      <Fold title={`Each gate (${mine.length})`} storageKey="cattle-gates-list">
        <ul className="mt-1 space-y-0.5">
          {mine.map((g) => (
            <li key={g.id}>
              <button
                disabled={!canEdit || busy}
                onClick={() => setOne.mutate({ id: g.id, open: !g.is_open })}
                title={
                  g.gate_geom
                    ? `${g.width_ft} ft gate. ${g.is_open ? 'Open — water carries through.' : 'Shut.'}`
                    : 'No place marked for this gate, so it cannot carry water through. Mark it on the grazing planner.'
                }
                className={cn(
                  'flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px]',
                  canEdit && 'hover:bg-gray-50',
                  g.is_open ? 'text-brand-700' : 'text-gray-600',
                )}
              >
                {g.is_open ? <DoorOpen className="h-3 w-3 shrink-0" /> : <DoorClosed className="h-3 w-3 shrink-0" />}
                <span className="truncate">
                  {g.a} ↔ {g.b}
                </span>
                {!g.gate_geom && <span className="ml-auto shrink-0 text-amber-700">no spot</span>}
              </button>
            </li>
          ))}
        </ul>
      </Fold>
    </div>
  )
}
