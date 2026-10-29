import { useRef, useState, type PointerEvent } from 'react'
import { PenLine, Trash2, Upload } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { signatureFromPicture, trimmedSignature, useDeleteMySignature, useMySignature, useSaveMySignature } from '@/lib/signature'
import { askConfirm } from '@/components/askConfirm'

const btn =
  'inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50'

/**
 * Your signature, drawn once or taken from a picture of it on paper, for
 * signing forms such as Corteva's seed report. Only you can see or use it.
 */
export function SignatureCard() {
  const mine = useMySignature()
  const save = useSaveMySignature()
  const remove = useDeleteMySignature()
  const [drawing, setDrawing] = useState(false)
  const [reading, setReading] = useState(false)
  const [pictureError, setPictureError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const image = mine.data?.image ?? null

  return (
    <div className="mt-3 space-y-1.5">
      <span className="text-xs text-gray-500">Signature</span>
      <div className="flex flex-wrap items-center gap-3">
        {image ? (
          <img src={image} alt="Your signature" className="h-14 max-w-[16rem] rounded border border-gray-200 bg-white object-contain p-1" />
        ) : (
          <span className="text-sm text-gray-500">{mine.isLoading ? 'Loading…' : 'None yet. Forms you sign use it.'}</span>
        )}
        <button type="button" onClick={() => setDrawing(true)} className={btn}>
          <PenLine className="h-4 w-4" /> {image ? 'Redraw' : 'Draw your signature'}
        </button>
        <button type="button" disabled={reading || save.isPending} onClick={() => file.current?.click()} className={btn} title="A photo or scan of your signature on white paper">
          <Upload className="h-4 w-4" /> {reading || (save.isPending && !drawing) ? 'Saving…' : 'Upload your signature'}
        </button>
        <input
          ref={file}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            setPictureError(null)
            setReading(true)
            signatureFromPicture(f)
              .then((png) => save.mutateAsync(png))
              .catch((err: Error) => setPictureError(err.message))
              .finally(() => setReading(false))
          }}
        />
        {image && (
          <button
            type="button"
            disabled={remove.isPending}
            onClick={async () => await askConfirm('Remove your signature? Forms already signed keep theirs.', { confirmLabel: 'Remove' }) && remove.mutate()}
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-700"
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </button>
        )}
      </div>
      {remove.error && <p className="text-xs text-red-600">{(remove.error as Error).message}</p>}
      {pictureError && <p className="text-xs text-red-600">{pictureError}</p>}
      {drawing && (
        <SignaturePad
          saving={save.isPending}
          error={save.error ? (save.error as Error).message : null}
          onCancel={() => {
            save.reset()
            setDrawing(false)
          }}
          onSave={(png) => save.mutate(png, { onSuccess: () => setDrawing(false) })}
        />
      )}
    </div>
  )
}

/** Sign with a finger, a pen or the mouse. */
function SignaturePad({ saving, error, onCancel, onSave }: { saving: boolean; error: string | null; onCancel: () => void; onSave: (png: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [empty, setEmpty] = useState(true)

  const at = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current!
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
  }
  const stroke = (to: { x: number; y: number }) => {
    const ctx = canvas.current!.getContext('2d')!
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    const from = last.current ?? to
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x + (from === to ? 0.1 : 0), to.y)
    ctx.stroke()
    last.current = to
  }
  const clear = () => {
    const c = canvas.current!
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setEmpty(true)
  }

  return (
    <Modal title="Your signature" onClose={onCancel}>
      <div className="space-y-3">
        <canvas
          ref={canvas}
          width={900}
          height={300}
          aria-label="Signature pad: draw your signature"
          className="w-full touch-none rounded-md border border-gray-300 bg-white"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            last.current = null
            stroke(at(e))
            setEmpty(false)
          }}
          onPointerMove={(e) => {
            if (last.current) stroke(at(e))
          }}
          onPointerUp={() => (last.current = null)}
          onPointerCancel={() => (last.current = null)}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={clear} className={btn}>
            Clear
          </button>
          <button type="button" onClick={onCancel} className={btn}>
            Cancel
          </button>
          <button
            type="button"
            disabled={empty || saving}
            onClick={() => {
              const png = trimmedSignature(canvas.current!)
              if (png) onSave(png)
            }}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save signature'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
