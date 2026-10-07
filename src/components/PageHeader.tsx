import type React from 'react'
import { cn } from '@/lib/utils'

/**
 * The top of a page: title, at most one line under it, and actions.
 *
 * Pages each drew their own header, at three sizes, some with an icon, some
 * with a paragraph under the title. The subtitle here is one line on purpose:
 * anything longer is an explanation, and goes in `info` (an InfoPopover or
 * HelpNote), not on the page.
 */
export function PageHeader({
  title,
  icon,
  subtitle,
  info,
  actions,
  className,
}: {
  title: React.ReactNode
  icon?: React.ReactNode
  /** One short line of facts — never a paragraph. */
  subtitle?: React.ReactNode
  /** An ⓘ beside the title for the explanation. */
  info?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-start justify-between gap-2', className)}>
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          {icon}
          <span className="truncate">{title}</span>
          {info}
        </h1>
        {subtitle && <p className="truncate text-xs text-gray-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
