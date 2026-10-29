import { Fragment } from 'react'
import type { ExportColumn } from '@/hooks/useExport'
import { ExportButton } from '@/components/ExportButton'
import { exportTable, titleFromFilename } from '@/lib/export-table'
import { CardList, RowCard } from '@/components/RowCards'
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
}

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
}: {
  row: Row
  columns: DataTableColumn<Row>[]
  onClick?: () => void
}) {
  const [first, ...rest] = columns
  return (
    <RowCard
      heading={first.render ? first.render(row) : (first.value(row) ?? '—')}
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
}: Props<Row>) {
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
            />
          ))}
        </CardList>
      )}
      <div className={cn('overflow-x-auto', !tableOnPhone && 'hidden sm:block')}>
        {/* Never squeezed narrower than its content: a column crushed to one
            word a line is harder to read than one scrolled to. */}
        <table className="w-max min-w-full text-sm">
          <thead className={TABLE_HEAD}>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={cn('px-3 py-2 font-medium', c.className)}>
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
                    onRowClick && 'cursor-pointer hover:bg-gray-50',
                  )}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-3 py-2', c.className)}>
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
