import { useRef, useState } from 'react'
import { FileText, Paperclip, Trash2 } from 'lucide-react'
import {
  productDocumentUrl,
  useAttachProductDocument,
  useProductDocuments,
  useRemoveProductDocument,
  useSaveProduct,
  type JdProduct,
} from '@/lib/products'

/**
 * What the Label column shows for a product with no PMRA registration.
 *
 * Three states, in the order a person meets them: a reason why there is no
 * label ("plant biostimulant, CFIA not PMRA"), a supplier sheet on file that
 * opens in a tab, and — for a manager — the means to add either. The amber
 * "Link…" stays until a reason is written, because until then the honest
 * state is "nobody has looked".
 */
export function ProductSheetCell({
  product,
  canEdit,
  onLink,
}: {
  product: JdProduct
  canEdit: boolean
  onLink: () => void
}) {
  const { data: docs } = useProductDocuments()
  const attach = useAttachProductDocument()
  const remove = useRemoveProductDocument()
  const save = useSaveProduct()
  const fileRef = useRef<HTMLInputElement>(null)
  const [editingNote, setEditingNote] = useState(false)
  const [note, setNote] = useState(product.label_note ?? '')
  const [showSummary, setShowSummary] = useState<string | null>(null)

  const mine = docs?.byProduct.get(product.id) ?? []

  const open = async (doc: (typeof mine)[number]) => {
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    try {
      const href = await productDocumentUrl(doc)
      if (tab) tab.location.href = href
      else window.open(href, '_blank', 'noopener')
    } catch {
      tab?.close()
    }
  }

  return (
    <div className="space-y-1 text-xs">
      {mine.map((d) => (
        <div key={d.id} className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => open(d)}
            title={d.title}
            className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
          >
            <FileText className="h-3.5 w-3.5" />
            Sheet
          </button>
          {d.summary && (
            <button
              type="button"
              onClick={() => setShowSummary(showSummary === d.id ? null : d.id)}
              className="text-gray-500 underline decoration-dotted hover:text-gray-900"
            >
              {showSummary === d.id ? 'less' : 'rate & timing'}
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Remove “${d.title}”?`)) remove.mutate(d)
              }}
              className="text-gray-300 hover:text-red-600"
              aria-label="Remove this sheet"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          {showSummary === d.id && d.summary && (
            <p className="basis-full whitespace-pre-line rounded bg-gray-50 px-2 py-1.5 text-[11px] text-gray-700">
              {d.summary}
            </p>
          )}
        </div>
      ))}

      {editingNote ? (
        <div className="flex items-start gap-1">
          <textarea
            autoFocus
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why there is no label — adjuvant, fertiliser, wrong name…"
            className="w-48 rounded border border-gray-300 px-1.5 py-1 text-[11px]"
          />
          <button
            type="button"
            onClick={() => {
              save.mutate({ id: product.id, label_note: note.trim() || null })
              setEditingNote(false)
            }}
            className="rounded bg-brand-700 px-1.5 py-1 text-[11px] font-semibold text-white"
          >
            Save
          </button>
        </div>
      ) : product.label_note ? (
        <p className="max-w-xs text-[11px] leading-snug text-gray-500">
          {product.label_note}
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditingNote(true)}
              className="ml-1 text-gray-400 underline decoration-dotted hover:text-gray-800"
            >
              edit
            </button>
          )}
        </p>
      ) : (
        <button
          type="button"
          onClick={onLink}
          className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
        >
          Link…
        </button>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
          {product.label_note && (
            <button type="button" onClick={onLink} className="underline decoration-dotted hover:text-gray-800">
              link a registration
            </button>
          )}
          {!product.label_note && !editingNote && (
            <button
              type="button"
              onClick={() => setEditingNote(true)}
              className="underline decoration-dotted hover:text-gray-800"
            >
              no label because…
            </button>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={attach.isPending}
            className="inline-flex items-center gap-0.5 underline decoration-dotted hover:text-gray-800 disabled:opacity-50"
          >
            <Paperclip className="h-3 w-3" />
            {attach.isPending ? 'uploading…' : 'attach a sheet'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) attach.mutate({ productId: product.id, file })
            }}
          />
          {(attach.error || remove.error) && (
            <span className="text-red-700">{((attach.error ?? remove.error) as Error).message}</span>
          )}
        </div>
      )}
    </div>
  )
}
