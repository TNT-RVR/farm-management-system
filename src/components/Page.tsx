import type React from 'react'
import { InfoPopover } from '@/components/InfoPopover'
import { cn } from '@/lib/utils'

/**
 * The frame every view opens in.
 *
 * Each page used to draw its own: a third were `p-4 md:p-6`, a fifth `p-4`,
 * some `p-3`, and twenty-eight centred themselves in an `mx-auto max-w-*` of
 * five different widths — so Chemicals started 264 px from the left of the
 * window and Fusarium risk 468 px, on the same screen. Below that, nearly
 * every page repeated its own name as an icon, a heading and a line of
 * description, which the breadcrumb in the header had already said.
 *
 * Sam, 20 Nov 2026: one identical frame everywhere. So the padding lives
 * here and nowhere else, the name is left to the breadcrumb (it stays in the
 * page as a heading for a screen reader, which has no breadcrumb to read),
 * and what the description used to say goes behind the ⓘ beside the tabs.
 *
 * The tabs are the first thing in the frame, so they land on the same line on
 * every view; anything the page can do sits beside them rather than on a row
 * of its own, which would push them down on some views and not others.
 */
export function Page({
  title,
  info,
  infoTitle,
  actions,
  tabs,
  children,
  className,
  bleed = false,
  narrow = false,
  showTitle = false,
}: {
  /**
   * The view's name. Not drawn — the breadcrumb says it — but read aloud.
   * Leave it out on a page that heads itself with the name of one record,
   * which the breadcrumb cannot know.
   */
  title?: React.ReactNode
  /**
   * Draw the heading after all. For a page about one record — a field, a cow,
   * a task — whose name the breadcrumb does not say.
   */
  showTitle?: boolean
  /**
   * What the description under the old heading said, behind an ⓘ — including
   * the page's own standing numbers, the counts and totals and last-synced
   * times the subtitle used to carry.
   *
   * There was a `note` slot here for a week that put those numbers back in
   * view as a grey line under the tabs, on the reading that a count is data
   * and wants seeing. Sam's answer was "behind the ⓘ" (23 Nov 2026), which
   * is also how he first put it — remove the title "along with the words
   * underneath it". So don't add it back: on this app a standing number is
   * not what a page opens with.
   *
   * A real warning is a different thing and does not belong here either. It
   * gets something that looks like a warning — see the amber strip on
   * Equipment and `lib/fleet-alerts.ts`.
   */
  info?: React.ReactNode
  /** Heading of the ⓘ panel, when the view's name is not the right one. */
  infoTitle?: string
  /** Buttons for the whole view, beside the tabs. */
  actions?: React.ReactNode
  /** A `PillTabs` or `PillNavTabs`, if the view has tabs. */
  tabs?: React.ReactNode
  children?: React.ReactNode
  className?: string
  /**
   * The body pads itself — a map edge to edge, or a view whose tabs each take
   * a different width. The frame still pads its own heading and tab row, so
   * the tabs land on the same line as on every other view.
   */
  bleed?: boolean
  /**
   * A column rather than the whole screen: a page about one record or one
   * form, where a line of text running the width of a desk monitor is worse
   * to read, not better. It still starts flush left — the old pages centred
   * themselves, which is what put the same app's views at five different
   * left edges.
   */
  narrow?: boolean
}) {
  const bar = !!(tabs || actions || info)
  return (
    <div className={cn(bleed ? 'pt-4 md:pt-6' : 'p-4 md:p-6', narrow && 'max-w-3xl', className)}>
      {title !== undefined && (
        <h1
          className={cn(
            showTitle ? 'mb-3 truncate text-lg font-semibold text-gray-900' : 'sr-only',
            showTitle && bleed && 'px-4 md:px-6',
          )}
        >
          {title}
        </h1>
      )}
      {/* items-start, so a tall button beside the tabs (Harvest's 44 px icons)
          does not push the tab row down a view's worth of pixels. */}
      {bar && (
        <div className={cn('mb-3 flex flex-wrap items-start gap-2', bleed && 'px-4 md:px-6')}>
          {tabs && <div className="min-w-0 flex-1 basis-48">{tabs}</div>}
          {info && (
            <InfoPopover
              title={infoTitle ?? (typeof title === 'string' ? title : 'About this page')}
              label={tabs || actions ? undefined : 'About this page'}
              className={cn('text-gray-400', tabs && 'mt-1.5')}
            >
              {info}
            </InfoPopover>
          )}
          {actions && (
            <div className={cn('flex w-full flex-wrap items-center gap-2 sm:w-auto', tabs ? 'sm:ml-auto' : 'ml-auto')}>
              {actions}
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  )
}
