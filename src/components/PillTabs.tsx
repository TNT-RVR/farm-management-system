import type React from 'react'
import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

/**
 * The one place the look is defined. Both variants read from it, so a change
 * here reaches the state tabs and the routed ones together — which is the whole
 * reason there is a component rather than a class string people copy.
 */
export const PILL_BASE = 'rounded-md px-3 py-1 text-sm font-medium transition-colors'
export const PILL_ON = 'bg-brand-700 text-white'
export const PILL_OFF = 'text-gray-600 hover:bg-gray-100'

/**
 * The tab bar the irrigation section uses everywhere.
 *
 * It existed three times in slightly different forms — the turbine station had
 * filled pills, AIMM and River had small underlined text, General Info had big
 * uppercase underlines — so moving between them looked like moving between
 * three applications. This is the turbine one, which was the best of them: a
 * filled pill reads as a chosen thing at a glance, and it survives being
 * tapped with a glove on better than a two-pixel underline.
 *
 * Shared rather than copied, because the reason there were three was that each
 * was written where it was needed.
 */
/**
 * `label` takes a node, not just a string, so a tab can carry a count beside
 * its name without the count having to be styled into the same word.
 */
export type PillTab<K extends string> = { key: K; label: React.ReactNode }

export function PillTabs<K extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: readonly PillTab<K>[]
  value: K
  onChange: (key: K) => void
  className?: string
}) {
  if (tabs.length === 0) return null
  return (
    <div
      role="tablist"
      className={cn('flex flex-wrap gap-1 border-b border-gray-200 pb-2', className)}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn(PILL_BASE, value === t.key ? PILL_ON : PILL_OFF)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/**
 * The same tabs, when each is its own route.
 *
 * Sections built from routes — Tasks/Checklists, Calendar/Monthly,
 * Inventory/Bins — need real links so the address bar and the back button keep
 * working. Only the mechanism differs; the look must not, or the app has two
 * kinds of tab again.
 */
export function PillNavTabs({
  tabs,
  className,
}: {
  tabs: readonly { to: string; label: string; end?: boolean }[]
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap gap-1 border-b border-gray-200 pb-2', className)}>
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) => cn(PILL_BASE, isActive ? PILL_ON : PILL_OFF)}
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  )
}
