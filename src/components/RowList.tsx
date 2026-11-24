import type React from 'react'
import { cn } from '@/lib/utils'

/**
 * A list of summary rows, at every width.
 *
 * `CardList` is the phone half of a card-and-table pair: it carries
 * `sm:hidden`, so a list built on it alone is invisible on anything wider
 * than a phone — and invisible in the browser pane too, which reports an
 * innerWidth of 0 when it is off screen and so renders every page as a
 * phone. That is how a list can look right while it is being checked and be
 * empty on the monitor it was built for.
 *
 * These rows are a title and a wrapped summary line, which reads the same on
 * a 375-pixel screen and a 1,600-pixel one. So: one list, no breakpoint.
 */
export function RowList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <ul className={cn('divide-y divide-gray-100', className)}>{children}</ul>
}
