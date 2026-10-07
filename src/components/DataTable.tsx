import { Download } from 'lucide-react'
import { useExport, type ExportColumn } from '@/hooks/useExport'
import { cn } from '@/lib/utils'

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
  onRowClick?: (row: Row) => void
  emptyMessage?: string
}

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  exportFilename,
  onRowClick,
  emptyMessage = 'Nothing here yet.',
}: Props<Row>) {
  const { exportCsv } = useExport()

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-end border-b border-gray-100 px-3 py-2">
        <button
          onClick={() => exportCsv(rows, columns, exportFilename)}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
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
              <tr
                key={rowKey(row)}
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
