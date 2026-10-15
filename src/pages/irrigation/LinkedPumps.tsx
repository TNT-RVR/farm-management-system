import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Gauge, X } from 'lucide-react'
import { Select } from '@/components/Select'
import { usePumps, type PumpRow } from '@/lib/irrigation'
import { usePumpContext } from '@/lib/pump-context'
import { useSetPinPumps } from '@/lib/farm-layers'
import { pumpInfoLink } from '@/lib/pump-pins'
import { cn } from '@/lib/utils'
import { PumpDetails } from '@/pages/irrigation/PumpDetails'

/**
 * The pump record(s) a map pin or checklist place stands for: nameplates,
 * panel, meter, flow and photos (photos load one by one as they show), with
 * a link to the pump's own section of Pump information.
 */
export function LinkedPumps({ pumpIds, isManager, defaultOpen = true }: { pumpIds: string[]; isManager: boolean; defaultOpen?: boolean }) {
  const { pumps, pivotsByPump, meterShares } = usePumpContext()
  const linked = pumpIds.map((id) => (pumps ?? []).find((p) => p.id === id)).filter((p): p is PumpRow => Boolean(p))
  if (!linked.length) return null
  return (
    <div className="space-y-2">
      {linked.map((p) => (
        <OnePump key={p.id} pump={p} pivots={pivotsByPump.get(p.id) ?? []} meterShares={meterShares(p)} isManager={isManager} defaultOpen={defaultOpen} />
      ))}
    </div>
  )
}

function OnePump({
  pump,
  pivots,
  meterShares,
  isManager,
  defaultOpen,
}: {
  pump: PumpRow
  pivots: { name: string; gpm: number | null }[]
  meterShares: { sharesWith: string | null; alsoOnIt: string[] }
  isManager: boolean
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="overflow-hidden rounded-md border border-gray-200 bg-white">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-1 text-left text-sm font-semibold text-gray-900" aria-expanded={open}>
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform', open && 'rotate-90')} />
          <Gauge className="h-3.5 w-3.5 shrink-0 text-brand-700" />
          <span className="truncate">{pump.name}</span>
        </button>
        <Link to={pumpInfoLink(pump.id)} className="shrink-0 text-xs font-medium text-brand-700 hover:underline">
          Pump information
        </Link>
      </div>
      {open && <PumpDetails pump={pump} pivots={pivots} isManager={isManager} meterShares={meterShares} stacked />}
    </section>
  )
}

/** A manager's choice of which pumps a pin marks. */
export function PinPumpPicker({ featureId, pumpIds }: { featureId: string; pumpIds: string[] }) {
  const { data: pumps } = usePumps()
  const set = useSetPinPumps()
  const free = (pumps ?? []).filter((p) => !pumpIds.includes(p.id))
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {pumpIds.map((id) => (
        <span key={id} className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-sky-900 ring-1 ring-sky-200">
          {(pumps ?? []).find((p) => p.id === id)?.name ?? 'Pump'}
          <button
            type="button"
            aria-label="Unlink this pump"
            disabled={set.isPending}
            onClick={() => set.mutate({ id: featureId, pumpIds: pumpIds.filter((x) => x !== id) })}
            className="rounded-full text-sky-700 hover:text-sky-950"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {free.length > 0 && (
        <Select
          size="sm"
          className="w-40"
          ariaLabel="Link a pump to this pin"
          placeholder="Link a pump…"
          value=""
          disabled={set.isPending}
          onChange={(id) => id && set.mutate({ id: featureId, pumpIds: [...pumpIds, id] })}
          options={free.map((p) => ({ value: p.id, label: p.name }))}
        />
      )}
      {set.error && <span className="text-red-600">{(set.error as Error).message}</span>}
    </div>
  )
}
