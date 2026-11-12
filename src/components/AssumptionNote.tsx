import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useCattleAssumptions } from '@/lib/cattle-assumptions'
import { InfoPopover } from '@/components/InfoPopover'
import { Fold } from '@/components/Fold'
import { cn } from '@/lib/utils'

/**
 * "What this depends on": every guessed or blank input behind the cattle
 * numbers, each a link to the box where it is fixed. Read from the live rows
 * (lib/cattle-assumptions.ts), so an item leaves the list the day it is filled.
 *
 * `ranchId` '' is every ranch. Folded by default; `open` shows it expanded.
 */
export function AssumptionNote({ ranchId, open = false, className }: { ranchId: string; open?: boolean; className?: string }) {
  const { data, isLoading, error } = useCattleAssumptions(ranchId)
  const items = data ?? []
  const missing = items.filter((a) => a.kind === 'missing').length
  const guessed = items.length - missing
  const allRanches = ranchId === ''

  const body = isLoading ? (
    <p className="px-3 py-2 text-sm text-gray-400">Checking…</p>
  ) : error ? (
    <p className="px-3 py-2 text-sm text-red-700">Couldn’t check the inputs: {(error as Error).message}</p>
  ) : items.length === 0 ? (
    <p className="px-3 py-2 text-sm text-emerald-700">Nothing guessed — every input is recorded.</p>
  ) : (
    <ul className="divide-y divide-gray-100">
      {items.map((a) => (
        <li key={a.key}>
          <Link to={a.to} className="flex items-start gap-2 px-3 py-2 text-sm hover:bg-gray-50">
            <span
              className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.kind === 'missing' ? 'bg-red-500' : 'bg-amber-400')}
              aria-label={a.kind === 'missing' ? 'Not recorded' : 'Guessed'}
            />
            <span className="min-w-0 flex-1 text-gray-800">
              {(allRanches || a.ranch == null) && (
                <span className="mr-1 text-xs font-medium text-gray-500">{a.ranch ?? 'Farm'} ·</span>
              )}
              {a.label}
            </span>
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-300" />
          </Link>
        </li>
      ))}
    </ul>
  )

  return (
    <Fold
      title="What this depends on"
      actions={
        <InfoPopover title="What this depends on">
          <p>Inputs behind the cattle numbers that are blank, a default, or someone&apos;s stand-in. Red is not recorded at all; amber is a guess.</p>
          <p>Tap one to go to where it is set. The list is read from the records each time, so it shrinks as gaps are filled.</p>
        </InfoPopover>
      }
      summary={
        isLoading ? (
          '…'
        ) : items.length === 0 ? (
          <span className="text-emerald-700">nothing to firm up</span>
        ) : (
          <>
            {items.length} {items.length === 1 ? 'thing' : 'things'} to firm up
            {missing > 0 && <span className="ml-1.5 font-medium text-red-700">· {missing} not recorded</span>}
            {guessed > 0 && <span className="ml-1.5 font-medium text-amber-700">· {guessed} guessed</span>}
          </>
        )
      }
      storageKey={`cattle-assumptions-v2${allRanches ? '-all' : ''}`}
      defaultOpen={open}
      className={className}
      bodyClassName="p-0"
    >
      {body}
    </Fold>
  )
}
