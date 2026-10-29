import { Fragment, type MouseEvent } from 'react'
import { cn } from '@/lib/utils'

/**
 * A wide table read down the page on a phone.
 *
 * Twelve columns on a 375-pixel screen is screens of sideways scrolling with
 * the date gone off the left after the first, so under `sm` each row becomes a
 * card: a heading, then the figures as label and value. From `sm` up the table
 * itself is shown, unchanged.
 *
 * Both are rendered and one is hidden, so build each row's facts once and give
 * the same nodes to the card and to the cells — `display: none` keeps the
 * hidden copy out of the screen reader's way too.
 */
export type Fact = {
  label: string
  node: React.ReactNode
  /** Only when two facts share a label. */ key?: string
}

/** Nothing worth a line of its own in a card. */
const blankNode = (n: React.ReactNode) =>
  n === null ||
  n === undefined ||
  n === false ||
  n === '' ||
  (typeof n === 'string' && (n.trim() === '' || n.trim() === '—'))

/** The label-and-value pairs under a card's heading, blanks left out. */
export function FactList({ facts, className }: { facts: Fact[]; className?: string }) {
  const shown = facts.filter((f) => !blankNode(f.node))
  if (shown.length === 0) return null
  return (
    <dl
      className={cn(
        'mt-1 grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-xs',
        className,
      )}
    >
      {shown.map((f) => (
        <Fragment key={f.key ?? f.label}>
          <dt className="text-gray-500">{f.label}</dt>
          <dd className="min-w-0 text-gray-900">{f.node}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

/** The phone list that holds the cards; hidden from `sm` up. */
export function CardList({
  children,
  empty,
  isEmpty,
  className,
}: {
  children: React.ReactNode
  /** What to say when there are no rows; leave out for a list that is only shown when there are some. */
  empty?: string
  isEmpty?: boolean
  className?: string
}) {
  return (
    <ul className={cn('divide-y divide-gray-100 sm:hidden', className)}>
      {isEmpty && empty ? (
        <li className="px-3 py-6 text-center text-sm text-gray-400">{empty}</li>
      ) : (
        children
      )}
    </ul>
  )
}

/** One row as a card: its heading, anything to press on the right, its facts. */
export function RowCard({
  heading,
  facts,
  onClick,
  actions,
  children,
}: {
  heading: React.ReactNode
  facts: Fact[]
  onClick?: (e: MouseEvent<HTMLElement>) => void
  actions?: React.ReactNode
  /** Anything under the facts: what a table row opens beneath it, in the card. */
  children?: React.ReactNode
}) {
  return (
    <li
      onClick={onClick}
      className={cn('px-3 py-2.5', onClick && 'cursor-pointer hover:bg-gray-50')}
    >
      <div className="flex items-start justify-between gap-2">
        {/* basis-auto, not flex-1: a heading with flex-basis 0 collapses to a word wide. */}
        <div className="min-w-0 flex-auto text-sm font-semibold text-gray-900">{heading}</div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <FactList facts={facts} />
      {/* What the row opens beneath it, fenced off from the facts above. */}
      {children && <div className="mt-2 border-t border-gray-100 pt-2">{children}</div>}
    </li>
  )
}
