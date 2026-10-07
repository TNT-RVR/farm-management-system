import { useMemo } from 'react'
import { Download, ExternalLink, FileText, X } from 'lucide-react'
import { useInvoiceUrl, useProductPurchases, type ProductPurchase } from '@/lib/products'
import { fmtMoney } from '@/lib/applied'
import { cn } from '@/lib/utils'
import { ImportHint } from '@/components/ImportHint'

/**
 * The invoice a price came from.
 *
 * Two halves, because they fail independently. The line items are in the
 * database and always render — they are what the importer actually read, so
 * this is also where you find out it read a pack size wrong. The PDF is the
 * paper, and it only appears once the file has been uploaded to the invoices
 * bucket; before that the panel says so rather than showing an empty frame.
 */
export function InvoiceViewer({
  invoiceNo,
  highlightProductId,
  onClose,
}: {
  invoiceNo: string
  highlightProductId?: string | null
  onClose: () => void
}) {
  const { data, isLoading } = useProductPurchases()

  const lines = useMemo(
    () =>
      (data?.rows ?? [])
        .filter((r) => r.invoice_no === invoiceNo)
        // Back to the order they sit on the page, so it reads like the invoice.
        .sort((a, b) => (a.ref_no ?? '').localeCompare(b.ref_no ?? '')),
    [data, invoiceNo],
  )

  const head = lines[0] as ProductPurchase | undefined
  const storagePath = lines.find((l) => l.storage_path)?.storage_path ?? null
  const { data: pdfUrl, isLoading: urlLoading } = useInvoiceUrl(storagePath)

  const total = lines.reduce((sum, l) => sum + Number(l.amount ?? 0), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 md:p-6">
      <div className="flex h-full max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
              <FileText className="h-4 w-4 text-gray-400" />
              Invoice {invoiceNo}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {head?.supplier ?? 'Supplier unknown'}
              {head?.invoice_date && ` · ${head.invoice_date}`}
              {lines.length > 0 && ` · ${lines.length} line${lines.length === 1 ? '' : 's'}`}
              {total > 0 && ` · ${fmtMoney(total)}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {pdfUrl && (
              <>
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </a>
                {/* download= asks Storage to send it as an attachment; without
                    it the browser shows the PDF instead of saving it. */}
                <a
                  href={`${pdfUrl}&download=${encodeURIComponent(`${invoiceNo}.pdf`)}`}
                  className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </a>
              </>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1 text-gray-400 hover:bg-gray-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-4">
            {isLoading ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : lines.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing recorded against this invoice number.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Qty</th>
                    <th className="py-2 pr-3 font-medium">Unit</th>
                    <th className="py-2 pr-3 font-medium">Description</th>
                    <th className="py-2 pr-3 text-right font-medium">Unit price</th>
                    <th className="py-2 pr-3 text-right font-medium">Per L/kg</th>
                    <th className="py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.map((l) => (
                    <tr
                      key={l.id}
                      className={cn(
                        highlightProductId &&
                          l.product_id === highlightProductId &&
                          'bg-amber-50 font-medium',
                      )}
                    >
                      <td className="py-2 pr-3 tabular-nums">{l.quantity ?? '—'}</td>
                      <td className="py-2 pr-3 text-gray-500">{l.pack_unit ?? '—'}</td>
                      <td className="py-2 pr-3 text-gray-800">{l.description}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {l.unit_price == null ? '—' : fmtMoney(Number(l.unit_price))}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-gray-500">
                        {l.price_per_canonical == null
                          ? '—'
                          : `${fmtMoney(Number(l.price_per_canonical))}/${l.canonical_unit ?? '?'}`}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {l.amount == null ? '—' : fmtMoney(Number(l.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="border-t border-gray-200 bg-gray-50 p-4">
            {urlLoading ? (
              <p className="text-sm text-gray-500">Fetching the PDF…</p>
            ) : pdfUrl ? (
              <object
                data={pdfUrl}
                type="application/pdf"
                className="h-[70vh] w-full rounded border border-gray-200 bg-white"
              >
                {/* Mobile browsers mostly refuse to embed a PDF at all. */}
                <p className="p-4 text-sm text-gray-600">
                  This browser won't show the PDF inline.{' '}
                  <a href={pdfUrl} target="_blank" rel="noreferrer" className="underline">
                    Open it in a new tab
                  </a>
                  .
                </p>
              </object>
            ) : (
              <div className="text-sm text-gray-500">
                <p>The lines above are what was read off this invoice. The PDF itself has not been uploaded.</p>
                <ImportHint what="original invoice PDFs" script="scripts/upload-invoices.mjs" screen="the invoice viewer">
                  <p>
                    Run{' '}
                    <code className="rounded bg-white px-1 py-0.5 text-xs">scripts/upload-invoices.mjs</code> to
                    file the originals so they can be opened here.
                  </p>
                </ImportHint>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
