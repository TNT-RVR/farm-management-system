import { cn } from '@/lib/utils'

/**
 * Grey shapes where a page or table is about to be (design review, Nov 2026).
 *
 * A line of "Loading…" that snaps to a full table moves everything under it;
 * on a truck's connection that reads as broken rather than slow. These hold
 * roughly the shape of what is coming. The pulse is off for anyone who has asked
 * their phone for less motion.
 */
function Bar({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div style={style} className={cn('rounded bg-gray-200/80 motion-safe:animate-pulse', className)} />
}

/** A table: the green bar, then rows of grey cells. */
export function TableSkeleton({ rows = 8, columns = 6, className }: { rows?: number; columns?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn('overflow-hidden rounded-lg border border-gray-200 bg-white', className)}>
      <div className="h-9 bg-brand-700/90" />
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-gray-100 px-3 py-3 last:border-0">
          {Array.from({ length: columns }, (_, c) => (
            <Bar key={c} className={cn('h-3', c === 0 ? 'w-28 shrink-0' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** A chart's box. */
export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn('flex h-64 items-end gap-2 px-4 pb-4', className)}>
      {[40, 65, 50, 80, 60, 75, 45, 70, 55, 85, 62, 48].map((h, i) => (
        <Bar key={i} className="flex-1" style={{ height: `${h}%` }} />
      ))}
    </div>
  )
}

/** A whole page arriving: a heading, a strip of tabs, then a table. */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="p-4 md:p-6">
      <Bar className="mb-4 h-6 w-48" />
      <div className="mb-4 flex gap-2">
        <Bar className="h-7 w-20" />
        <Bar className="h-7 w-24" />
        <Bar className="h-7 w-16" />
      </div>
      <TableSkeleton rows={6} />
    </div>
  )
}
