import { Suspense, type ReactNode } from 'react'
import { TableSkeleton } from '@/components/Skeleton'

/**
 * The boundary for a page's lazily loaded tabs. Same fallback as AppShell's page
 * boundary, but inside the page, so the page header and tab strip stay put while
 * the tab's code arrives instead of the whole page blinking to "Loading…".
 * Grey rows in the shape of a table rather than the word (design review, Nov 2026).
 */
export function TabSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={<TableSkeleton rows={6} className="mt-2" />}>{children}</Suspense>
}
