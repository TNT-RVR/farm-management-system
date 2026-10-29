import { Fan, Flame } from 'lucide-react'
import { useSetBinRun, type BinRun } from '@/lib/bins'
import { cn } from '@/lib/utils'

/**
 * The fan and the heater beside a bin's name (Sam, 27 Oct 2026): grey when
 * off, blue and red when they are running, and a tap switches them.
 *
 * Only the ones the bin has are shown — the switch is offered by ticking
 * "aeration fan" or "heater" on the bin itself — so a yard of plain hopper
 * bins looks exactly as it did.
 */
export function BinRunSwitches({
  bin,
  canEdit = true,
  className,
}: {
  bin: { id: string; name: string } & BinRun
  canEdit?: boolean
  className?: string
}) {
  const set = useSetBinRun()
  if (!bin.has_aeration && !bin.has_heater) return null

  const button = (
    kind: 'fan' | 'heat',
    on: boolean,
    Icon: typeof Fan,
    onColour: string,
  ) => (
    <button
      type="button"
      disabled={!canEdit}
      onClick={() => set.mutate({ id: bin.id, ...(kind === 'fan' ? { aeration: !on } : { heater: !on }) })}
      title={`${kind === 'fan' ? 'Fan' : 'Heat'} is ${on ? 'on' : 'off'}${canEdit ? ` — tap to switch it ${on ? 'off' : 'on'}` : ''}`}
      aria-pressed={on}
      aria-label={`${bin.name}: ${kind === 'fan' ? 'aeration fan' : 'heater'} ${on ? 'on' : 'off'}`}
      className={cn(
        'rounded p-0.5 disabled:cursor-default',
        on ? onColour : 'text-gray-400',
        canEdit && 'hover:bg-gray-100',
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  )

  return (
    <span className={cn('flex shrink-0 items-center gap-0.5', className)}>
      {bin.has_aeration && button('fan', bin.aeration_on, Fan, 'text-sky-600')}
      {bin.has_heater && button('heat', bin.heater_on, Flame, 'text-red-600')}
    </span>
  )
}
