import { useEffect } from 'react'
import { Download, ExternalLink, FileText, X } from 'lucide-react'
import { documentKind, useDocumentUrl, type DocumentListItem } from '@/lib/documents'

/**
 * The original, over the top of whatever screen you were on.
 *
 * Deliberately the same shape as the invoice viewer it grew out of: an
 * `<object>` for a PDF, an `<img>` for a photo, and a plain link for anything
 * else. Mobile browsers mostly refuse to embed a PDF, so the fallback inside
 * the object is a real link rather than an empty grey box.
 *
 * The URL is signed and lasts an hour. It is fetched when the viewer opens
 * rather than held on the row, because every bucket here is private and a
 * signed URL sitting in a list is a link anyone with the page can follow.
 */
export function DocumentViewer({ doc, onClose }: { doc: DocumentListItem; onClose: () => void }) {
  const kind = documentKind(doc)
  const { data: url, error } = useDocumentUrl(doc)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const sub = [
    doc.doc_type,
    doc.party,
    doc.doc_date,
    doc.crop_year ? `${doc.crop_year} crop` : null,
    doc.bytes ? `${Math.round(doc.bytes / 1024)} KB` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 md:p-6">
      <div className="flex h-full max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
              <FileText className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="truncate">{doc.title}</span>
            </h2>
            {sub && <p className="mt-0.5 truncate text-xs text-gray-500">{sub}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {url && (
              <>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </a>
                {/* download= asks Storage to send it as an attachment; without
                    it the browser shows the file instead of saving it. */}
                <a
                  href={`${url}&download=${encodeURIComponent(doc.filename)}`}
                  className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </a>
              </>
            )}
            <button onClick={onClose} aria-label="Close" className="rounded p-1 text-gray-400 hover:bg-gray-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-50 p-4">
          {error ? (
            <p className="text-sm text-red-700">
              {error instanceof Error ? error.message : 'Could not open this file.'}
            </p>
          ) : !url ? (
            <p className="text-sm text-gray-500">Fetching the file…</p>
          ) : kind === 'pdf' ? (
            <object data={url} type="application/pdf" className="h-[78vh] w-full rounded border border-gray-200 bg-white">
              <p className="p-4 text-sm text-gray-600">
                This browser won't show the PDF inline.{' '}
                <a href={url} target="_blank" rel="noreferrer" className="underline">
                  Open it in a new tab
                </a>
                .
              </p>
            </object>
          ) : kind === 'image' ? (
            <img src={url} alt={doc.title} className="mx-auto max-h-[78vh] rounded border border-gray-200 bg-white" />
          ) : (
            <p className="text-sm text-gray-600">
              {doc.filename} is not a kind this can show.{' '}
              <a href={url} target="_blank" rel="noreferrer" className="underline">
                Open it
              </a>{' '}
              or download it.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
