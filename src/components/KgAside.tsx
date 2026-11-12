import { kgText } from '@/lib/lbs-kg'
import { cn } from '@/lib/utils'

/**
 * The kilograms beside a pounds figure (Sam, 2 Nov 2026).
 *
 * Draws nothing at all for a crop measured in bushels, hundredweight or
 * tonnes, so it can be dropped in beside any yield without the call site
 * having to ask what the crop is. lib/lbs-kg.ts says why only pounds convert.
 *
 * Quieter than the figure it follows: the pounds are what the farm works in
 * and the kilograms are there for whoever is being sent the number.
 */
export function KgAside({
  value,
  unit,
  per = '/ac',
  lbPerBu,
  className,
}: {
  value: number | null | undefined
  unit: string | null | undefined
  /** What trails the unit here: '/ac' for a rate, '' for a total weight. */
  per?: string
  /**
   * The crop's test weight, for a figure in bushels. A bushel is a volume, so
   * without it there is nothing to convert and nothing is drawn — never a
   * weight guessed from an average.
   */
  lbPerBu?: number | null
  className?: string
}) {
  const text = kgText(value, unit, per, lbPerBu)
  if (!text) return null
  return <span className={cn('ml-1 whitespace-nowrap text-gray-400', className)}>({text})</span>
}
