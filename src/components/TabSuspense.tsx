import { Suspense, type ReactNode } from 'react'

/**
 * The boundary for a page's lazily loaded tabs. Same fallback as AppShell's page
 * boundary, but inside the page, so the page header and tab strip stay put while
 * the tab's code arrives instead of the whole page blinking to "Loading…".
 */
export function TabSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading…</div>}>{children}</Suspense>
}
