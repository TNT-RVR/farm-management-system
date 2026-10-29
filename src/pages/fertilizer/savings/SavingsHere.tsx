import { Suspense } from 'react'
import { lazyWithRetry } from '@/lib/lazyWithRetry'

// The tools and the records they read load only when a tab showing one opens.
const HereBody = lazyWithRetry(() => import('./HereBody').then((m) => ({ default: m.HereBody })))

/**
 * Savings tools shown at the foot of the tab that owns their question
 * (lib/fert-savings/homes.ts): the plan's need-versus-booked under
 * Requirements, the P and K balance under Nutrient history, and so on. The
 * Savings tab lists them under "Where the savings live" with a link here.
 */
export function SavingsHere({ ids, className }: { ids: readonly number[]; className?: string }) {
  return (
    <section className={className ?? 'mt-6 space-y-2'}>
      <h2 className="text-sm font-semibold text-gray-900">
        Fertilizer savings <span className="font-normal text-gray-500">— from the Savings list</span>
      </h2>
      <Suspense fallback={<p className="text-xs text-gray-400">Loading…</p>}>
        <HereBody ids={ids} />
      </Suspense>
    </section>
  )
}
