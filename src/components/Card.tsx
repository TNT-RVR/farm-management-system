import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { CARD_HEAD, CARD_HEAD_TEXT } from '@/lib/table-style'

/**
 * A white bordered card with a title.
 * - header="bar" (default): the title, and `right` beside it, in the same
 *   green bar a table wears (lib/table-style.ts), so a chart card and a table
 *   read as the same kind of object on one page (Sam, 29 Oct 2026).
 * - header="inline": the title (with an optional icon) sits at the top of the
 *   padded card, as on the Calculator. No bar, so no green.
 */
export function Card({
  title,
  icon: Icon,
  right,
  header = 'bar',
  className,
  children,
}: {
  title: ReactNode
  icon?: ComponentType<{ className?: string }>
  right?: ReactNode
  header?: 'bar' | 'inline'
  className?: string
  children: ReactNode
}) {
  const heading = (
    <h2
      className={cn(
        header === 'inline'
          ? 'mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900'
          : cn('flex items-center gap-1.5', CARD_HEAD_TEXT),
      )}
    >
      {Icon && <Icon className={cn('h-4 w-4', header === 'inline' ? 'text-brand-700' : 'text-white')} />}
      {title}
    </h2>
  )
  if (header === 'inline')
    return (
      <section className={cn('rounded-lg border border-gray-200 bg-white p-4', className)}>
        {right ? (
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            {heading}
            {right}
          </div>
        ) : (
          heading
        )}
        {children}
      </section>
    )
  return (
    // overflow-hidden so the green bar is clipped to the rounded corners
    // rather than squaring them off.
    <section className={cn('overflow-hidden rounded-lg border border-gray-200 bg-white', className)}>
      <div className={cn('flex flex-wrap items-baseline justify-between gap-2', CARD_HEAD)}>
        {heading}
        {right}
      </div>
      <div className="p-3">{children}</div>
    </section>
  )
}
