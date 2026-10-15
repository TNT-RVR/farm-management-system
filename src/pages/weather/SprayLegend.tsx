import type { SprayHour } from '@/lib/field-work-weather'
import { cn } from '@/lib/utils'

/** The spray strip's colours, one place so the strip and its key can't disagree. */
export const SPRAY_KEY = [
  { cls: 'bg-green-600', label: 'Best bee-safe spray window' },
  { cls: 'bg-green-300', label: 'Fit to spray, bees home' },
  { cls: 'bg-amber-300', label: 'Fit to spray, but bees are flying' },
  { cls: 'bg-gray-200', label: 'Don’t spray (wind, rain, heat, cold or dry air)' },
] as const

export function sprayCellClass(h: Pick<SprayHour, 'ok' | 'bees'>, inWindow: boolean): string {
  return inWindow ? SPRAY_KEY[0].cls : h.ok && !h.bees ? SPRAY_KEY[1].cls : h.ok ? SPRAY_KEY[2].cls : SPRAY_KEY[3].cls
}

/** The key to the spray colours. */
export function SprayLegend({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-600', !compact && 'rounded-lg border border-gray-200 bg-white px-3 py-2')}>
      {!compact && <span className="font-semibold text-gray-700">Spray hours key:</span>}
      {SPRAY_KEY.map((k, i) => (
        <span key={k.label} className="inline-flex items-center gap-1.5">
          <span className={cn('inline-block h-3 w-5 rounded-sm ring-1 ring-inset ring-black/10', k.cls)} />
          {compact && i === 0 ? 'Bee-safe spray hour' : k.label}
        </span>
      ))}
    </div>
  )
}
