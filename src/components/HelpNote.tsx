import type React from 'react'
import { InfoPopover } from '@/components/InfoPopover'
import { cn } from '@/lib/utils'

/**
 * One grey line under a table or card, with the full explanation behind ⓘ.
 *
 * Replaces the always-visible footnote paragraphs that explained how a number
 * was worked out. Those were read once and then sat on the page for good,
 * pushing the thing they explained off the screen. The line says what a
 * reader needs at a glance; the popover keeps every word of the method for
 * whoever wants it, so nothing is lost by moving it.
 *
 * Leave `summary` empty to show only the ⓘ (with `label`, if given). Warnings
 * about the state of the data — "324 ac have no seeding record" — are not
 * method notes and should stay visible as they were.
 */
export function HelpNote({
  summary,
  title = 'How this works',
  label,
  children,
  className,
  width,
}: {
  /** At most one short sentence, always visible. */
  summary?: React.ReactNode
  /** Heading of the popover. */
  title?: string
  /** Text beside the ⓘ when there is no summary to hang it on. */
  label?: string
  /** The full explanation, shown when ⓘ is tapped. */
  children: React.ReactNode
  className?: string
  width?: number
}) {
  return (
    <div className={cn('flex items-start gap-1 text-[11px] leading-snug text-gray-500', className)}>
      {summary && <span>{summary}</span>}
      <InfoPopover title={title} label={summary ? undefined : (label ?? 'How this works')} width={width}>
        {children}
      </InfoPopover>
    </div>
  )
}
