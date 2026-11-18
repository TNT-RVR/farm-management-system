import { Fragment } from 'react'
import type { ExportColumn } from '@/hooks/useExport'
import { ExportButton } from '@/components/ExportButton'
import { exportTable, titleFromFilename } from '@/lib/export-table'
import { CardList, RowCard, SummaryLine } from '@/components/RowCards'
import { cn } from '@/lib/utils'
import { TABLE_HEAD } from '@/lib/table-style'

/**
 * The one list-view table for the whole app (SPEC §7): renders columns,
 * handles row click, and wires the shared CSV export. Reuse this — never
 * write a second table + export implementation.
 */
export type DataTableColumn<Row> = ExportColumn<Row> & {
  className?: string
  render?: (row: Row) => React.ReactNode
}

type Props<Row> = {
  rows: Row[]
  columns: DataTableColumn<Row>[]
  rowKey: (row: Row) => string
  exportFilename: string
  /** The title on the exported PDF; the filename, tidied up, when not given. */
  exportTitle?: string
  onRowClick?: (row: Row) => void
  emptyMessage?: string
  /** Extra table rows under a row (its sub-rows), as <tr> elements; not exported. */
  renderAfter?: (row: Row) => React.ReactNode
  /**
   * Keep the table on a phone instead of a card for each row: for a table of
   * three or four narrow columns, which fits as it is, or one whose rows open
   * sub-rows of their own (`renderAfter`), which a card cannot carry.
   */
  tableOnPhone?: boolean
  /**
   * Fit the table to the width it is given instead of to its content.
   *
   * The default below is `w-max`: a column is never squeezed narrower than
   * what is in it, which is right for a table of figures, where a number
   * broken over two lines is worse than a sideways scroll. It is wrong for a
   * table of sentences -- a column holding a line of prose makes the table
   * far wider than the window, and whatever sits to its right (a button the
   * row is there to be decided by) ends up off the edge behind a scrollbar at
   * the bottom of the page.
   *
   * With this set the browser's own column sizing shares out the available
   * width, so cells whose content is allowed to wrap (`whitespace-normal`)
   * give way first. Only for tables whose columns can wrap.
   */
  fitWidth?: boolean
  /**
   * Keep the first column in place while the rest scrolls sideways, so a
   * figure far to the right is still read against the field it belongs to
   * (design review, Nov 2026: the plan's margin columns sit past the edge of
   * a 1440px window). For wide tables whose first column names the row.
   */
  stickyFirstColumn?: boolean
  /**
   * Tighter cells (8px each side, not 12) for a wide table of figures: on
   * fourteen columns that is 112px, enough to bring one more column into view.
   */
  compact?: boolean
  /**
   * The phone card's figures as one line instead of a label for each column
   * (see RowCards' SummaryLine): for a row whose figures carry their own units.
   * A column keyed `actions` still shows, at the card's top right.
   */
  phoneSummary?: (row: Row) => React.ReactNode
}

/** The pinned first cell: opaque, so the columns slide underneath it. */
const STICKY_TD = 'sticky left-0 z-[1] bg-white shadow-[1px_0_0_#f3f4f6]'
const STICKY_TH = 'sticky left-0 z-[2] bg-brand-700'

/**
 * One row as a card, for a phone (Sam, 27 Oct 2026: the financials "are not
 * set up" for one). The first column is the heading, the rest are label and
 * figure; a column with nothing in it is left out, but one that renders
 * something of its own (a box to type in, a badge) always shows, because that
 * is something to use, not a blank. See components/RowCards.tsx.
 */
function TableRowCard<Row>({
  row,
  columns,
  onClick,
  summary,
}: {
  row: Row
  columns: DataTableColumn<Row>[]
  onClick?: () => void
  summary?: (row: Row) => React.ReactNode
}) {
  const [first, ...rest] = columns
  const actions = summary ? columns.find((c) => c.key === 'actions') : undefined
  return (
    <RowCard
      heading={first.render ? first.render(row) : (first.value(row) ?? '—')}
      summary={summary ? <SummaryLine>{summary(row)}</SummaryLine> : undefined}
      actions={actions?.render?.(row) ?? undefined}
      facts={rest.map((c) => ({
        key: c.key,
        label: c.label,
        node: (c.render ? c.render(row) : c.value(row)) as React.ReactNode,
      }))}
      onClick={onClick}
    />
  )
}

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  exportFilename,
  exportTitle,
  onRowClick,
  emptyMessage = 'Nothing here yet.',
  renderAfter,
  tableOnPhone,
  fitWidth,
  stickyFirstColumn,
  compact,
  phoneSummary,
}: Props<Row>) {
  const pad = compact ? 'px-2 py-2' : 'px-3 py-2'
  return (
    <>
      {/* Export sits above the card, top right, in the same shape as the
          page's own buttons (Sam, 29 Oct 2026). Inside the card it put a
          strip across the top and a band of dead space above the column
          names; the card opens straight onto its green bar now. */}
      <div className="mb-2 flex justify-end">
        <ExportButton
          label={`Export ${exportTitle ?? titleFromFilename(exportFilename)}`}
          onExport={(format) =>
            exportTable(format, rows, columns, { filename: exportFilename, title: exportTitle })
          }
        />
      </div>
      {/* overflow-hidden so the green bar is clipped to the rounded corners
          instead of squaring off the top of the card. */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* A phone reads the rows down the page; from sm up it is the table. */}
      {!tableOnPhone && (
        <CardList empty={emptyMessage} isEmpty={rows.length === 0}>
          {rows.map((row) => (
            <TableRowCard
              key={rowKey(row)}
              row={row}
              columns={columns}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              summary={phoneSummary}
            />
          ))}
        </CardList>
      )}
      <div className={cn('overflow-x-auto', !tableOnPhone && 'hidden sm:block')}>
        {/* Never squeezed narrower than its content: a column crushed to one
            word a line is harder to read than one scrolled to. `fitWidth`
            turns that off for a table of sentences -- see the prop. */}
        <table className={cn('text-sm', fitWidth ? 'w-full table-auto' : 'w-max min-w-full')}>
          <thead className={TABLE_HEAD}>
            <tr>
              {columns.map((c, i) => (
                <th key={c.key} className={cn(pad, 'font-medium', c.className, stickyFirstColumn && i === 0 && STICKY_TH)}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-gray-400">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <Fragment key={rowKey(row)}>
                <tr
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-gray-100 last:border-0',
                    onRowClick && 'group cursor-pointer hover:bg-gray-50',
                  )}
                >
                  {columns.map((c, i) => (
                    <td
                      key={c.key}
                      className={cn(
                        pad,
                        c.className,
                        stickyFirstColumn && i === 0 && STICKY_TD,
                        stickyFirstColumn && i === 0 && onRowClick && 'group-hover:bg-gray-50',
                      )}
                    >
                      {c.render ? c.render(row) : (c.value(row) ?? '—')}
                    </td>
                  ))}
                </tr>
                {renderAfter?.(row)}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </>
  )
}
