import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, ImagePlus, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/Modal'

/**
 * The picture of a scale ticket, kept with the ticket so anyone can look at
 * the original (Sam, 3 Oct 2026). Stored as a resized JPEG in
 * scale_ticket_photos; only which tickets have one is read with the list, the
 * image itself when it is opened — and never saved on the device.
 */

/** Long side of the copy the app keeps: sharp enough to read every figure. */
const KEEP_PX = 1600

/** Which tickets have a photo, and the photo's id. */
export function useTicketPhotoIndex() {
  return useQuery({
    queryKey: ['scale_ticket_photo_index'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('scale_ticket_photos').select('id, scale_ticket_id').order('created_at')
      if (error) throw error
      const m = new Map<string, string>()
      for (const r of data ?? []) if (r.scale_ticket_id && !m.has(r.scale_ticket_id)) m.set(r.scale_ticket_id, r.id)
      return m
    },
  })
}

/** A photo, resized in the browser before it is sent: a phone picture is 3–5 MB. */
export async function shrinkPhoto(file: File): Promise<{ b64: string; width: number; height: number; bytes: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, KEEP_PX / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return { b64, width, height, bytes: Math.round((b64.length * 3) / 4) }
}

/** The camera button on a ticket's row: view its photo, or add one. */
export function TicketPhotoButton({ ticketId, photoId, label, canEdit }: { ticketId: string; photoId: string | undefined; label: string; canEdit: boolean }) {
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const add = useMutation({
    mutationFn: async (file: File) => {
      const p = await shrinkPhoto(file)
      const { error } = await supabase.from('scale_ticket_photos').insert({
        scale_ticket_id: ticketId,
        filename: file.name,
        mime: 'image/jpeg',
        image_b64: p.b64,
        width: p.width,
        height: p.height,
        bytes: p.bytes,
        source: 'upload',
      })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['scale_ticket_photo_index'] }),
  })

  if (!photoId) {
    if (!canEdit) return null
    return (
      <>
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={add.isPending}
          className="rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-brand-700"
          title={add.isError ? (add.error as Error).message : 'Add a photo of the ticket'}
          aria-label="Add a photo of the ticket"
        >
          {add.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className={`h-3.5 w-3.5 ${add.isError ? 'text-red-600' : ''}`} />}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) add.mutate(f)
            e.target.value = ''
          }}
        />
      </>
    )
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded p-1 text-brand-700 hover:bg-brand-50"
        title="See the ticket"
        aria-label={`See the photo of ${label}`}
      >
        <Camera className="h-3.5 w-3.5" />
      </button>
      {open && <TicketPhotoViewer photoId={photoId} label={label} onClose={() => setOpen(false)} />}
    </>
  )
}

function TicketPhotoViewer({ photoId, label, onClose }: { photoId: string; label: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['scale-ticket-photo', photoId],
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('scale_ticket_photos').select('mime, image_b64, filename, source, created_at').eq('id', photoId).single()
      if (error) throw error
      return data
    },
  })
  const src = data ? `data:${data.mime};base64,${data.image_b64}` : null
  return (
    <Modal title={label} onClose={onClose} wide>
      {isLoading && <p className="py-10 text-center text-sm text-gray-400">Loading the photo…</p>}
      {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
      {src && (
        <div className="space-y-2">
          <img src={src} alt={label} className="mx-auto max-h-[75dvh] w-auto rounded border border-gray-200" />
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{data!.source === 'email' ? 'From the email it came on' : 'Added in the app'} · {data!.created_at.slice(0, 10)}</span>
            <a href={src} download={(data!.filename ?? 'ticket').replace(/\.\w+$/, '') + '.jpg'} className="font-medium text-brand-700 hover:underline">
              Download
            </a>
          </div>
        </div>
      )}
    </Modal>
  )
}
