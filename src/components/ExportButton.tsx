import { useEffect, useRef, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Export, as one small icon button above a table (Sam, 29 Oct 2026).
 *
 * It used to be a wide "Export CSV" button on a white strip inside the card,
 * above the green header — which put a white seam across the top of every
 * table and a band of dead space above the column names. The button sits
 * outside the card now, top right, in the same shape as Add field and Import
 * boundaries, so the card opens straight onto its green bar.
 *
 * It asks for the format rather than assuming CSV: the same list is worth a
 * PDF when it is going to somebody — an agronomist, the bank, AFSC — and
 * every PDF in the app already goes through lib/table-report.ts.
 */
export function ExportButton({
  onExport,
  label = 'Export',
  className,
}: {
  onExport: (format: 'CSV' | 'PDF') => void | Promise<void>
  /** What it is exporting, for the tooltip and screen readers. */
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'CSV' | 'PDF' | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const pick = async (format: 'CSV' | 'PDF') => {
    setOpen(false)
    setFailed(null)
    setBusy(format)
    try {
      await onExport(format)
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div ref={box} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-32 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          {(['CSV', 'PDF'] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="menuitem"
              onClick={() => void pick(f)}
              className="block w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50"
            >
              {f === 'CSV' ? 'CSV — a spreadsheet' : 'PDF — to print or send'}
            </button>
          ))}
        </div>
      )}

      {failed && (
        <p className="absolute right-0 top-full z-30 mt-1 whitespace-nowrap rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] text-red-600 shadow">
          {failed}
        </p>
      )}
    </div>
  )
}
