import type { ReactNode } from 'react'
import type { ExportColumn } from '@/hooks/useExport'

/** How a column looks on screen, over and above what goes in the file. */
export type Display<Row> = { className?: string; render?: (row: Row) => ReactNode }

/**
 * A list's export columns dressed for the screen.
 *
 * The columns a list exports are written once, in lib/reports, so the page's
 * own Export CSV button and the Reports page produce the same file. The page
 * adds only what is drawn — a checkbox, a link, a coloured badge — on top.
 */
export function withDisplay<Row>(cols: ExportColumn<Row>[], display: Record<string, Display<Row>>): (ExportColumn<Row> & Display<Row>)[] {
  return cols.map((c) => ({ ...c, ...display[c.key] }))
}
