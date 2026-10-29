import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { AlertTriangle, ChevronLeft, ChevronRight, ImagePlus, Loader2, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/Modal'
import { shrinkPhoto } from '@/pages/contracts/TicketPhoto'
import { flagLines, type PlateLine } from '@/lib/equipment-details'
import { PHOTO_TABLES, useEquipmentPhotoIndex, type EquipmentPhotoMeta, type PhotoKind } from '@/lib/equipment-photos'
import { EQUIPMENT_PHOTO_BUCKET, savePhoto, uploadPhoto, usePhotoUrls } from '@/lib/stored-photos'
import { askConfirm } from '@/components/askConfirm'

/**
 * The pieces a pump's and a pivot's details are both made of: a plate (label /
 * value lines), the things to check, and the photos.
 */

export function PlateBlock({ title, rows, empty }: { title: string; rows: PlateLine[]; empty: string }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{title}</p>
      {rows.length ? (
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-gray-500">{k}</dt>
              <dd className="text-gray-900">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-1 text-xs text-gray-400">{empty}</p>
      )}
    </div>
  )
}

/** Things on the record that disagree, one per line of equipment_flags. */
export function FlagList({ text }: { text: string | null | undefined }) {
  const flags = flagLines(text)
  if (!flags.length) return null
  return (
    <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
      {flags.map((f) => (
        <li key={f} className="flex items-start gap-1.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>
            <b>Check:</b> {f}
          </span>
        </li>
      ))}
    </ul>
  )
}

type PhotoUrls = UseQueryResult<Map<string, string>>

/** One photo's image: its signed link from the batch the list made (never saved on the device). */
function usePhotoSrc(photo: EquipmentPhotoMeta, urls: PhotoUrls) {
  return { src: urls.data?.get(photo.storage_path) ?? null, isLoading: urls.isLoading, error: urls.error }
}

/**
 * A pump's or pivot's photos as thumbnails (Sam, 7 Oct 2026: the photos were
 * there but showed only as captions, so they read as missing). Click one for
 * the full picture, with the others an arrow away; a manager can add photos,
 * rename one and remove one.
 */
export function EquipmentPhotos({
  kind,
  ownerId,
  ownerName,
  isManager,
  emptyHint,
}: {
  kind: PhotoKind
  ownerId: string
  ownerName: string
  isManager: boolean
  /** What to photograph, shown to a manager when there are none yet. */
  emptyHint: string
}) {
  const t = PHOTO_TABLES[kind]
  const { data: index } = useEquipmentPhotoIndex(kind)
  const photos = index?.get(ownerId) ?? []
  const urls = usePhotoUrls(EQUIPMENT_PHOTO_BUCKET, photos.flatMap((p) => (p.storage_path ? [p.storage_path] : [])))
  const [openAt, setOpenAt] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const add = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        const p = await shrinkPhoto(file)
        const id = crypto.randomUUID()
        const path = await uploadPhoto(EQUIPMENT_PHOTO_BUCKET, `${kind}/${ownerId}/${id}.jpg`, p.b64)
        const row = {
          id,
          [t.owner]: ownerId,
          caption: file.name.replace(/\.\w+$/, ''),
          filename: file.name,
          mime: 'image/jpeg',
          storage_path: path,
          width: p.width,
          height: p.height,
          bytes: p.bytes,
          source: 'upload',
        }
        // The two tables share a shape; only the owner column differs.
        const { error } = await supabase.from(t.table).insert(row as never)
        if (error) {
          await supabase.storage.from(EQUIPMENT_PHOTO_BUCKET).remove([path])
          throw error
        }
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: [t.indexKey] }),
  })
  const remove = useMutation({
    mutationFn: async (photo: EquipmentPhotoMeta) => {
      const { error } = await supabase.from(t.table).delete().eq('id', photo.id)
      if (error) throw error
      if (photo.storage_path) await supabase.storage.from(EQUIPMENT_PHOTO_BUCKET).remove([photo.storage_path])
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: [t.indexKey] }),
  })
  const rename = useMutation({
    mutationFn: async (v: { id: string; caption: string }) => {
      const { error } = await supabase.from(t.table).update({ caption: v.caption.trim() || null } as never).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: [t.indexKey] }),
  })
  const open = openAt != null ? (photos[openAt] ?? null) : null
  const failed = add.error ?? remove.error ?? rename.error

  return (
    <div>
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Photos{photos.length ? ` (${photos.length})` : ''}</p>
        {isManager && (
          <>
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={add.isPending}
              className="flex items-center gap-1 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
            >
              {add.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />} Add photos
            </button>
            <input
              ref={input}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const fs = [...(e.target.files ?? [])]
                if (fs.length) add.mutate(fs)
                e.target.value = ''
              }}
            />
          </>
        )}
        {failed && <span className="text-[11px] text-red-600">{(failed as Error).message}</span>}
      </div>
      {photos.length === 0 ? (
        <p className="mt-1 text-xs text-gray-400">No photos yet{isManager ? ` — ${emptyHint}` : '.'}</p>
      ) : (
        <ul className="mt-1.5 grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
          {photos.map((p, i) => (
            <li key={p.id}>
              <Thumb photo={p} urls={urls} onOpen={() => setOpenAt(i)} />
            </li>
          ))}
        </ul>
      )}
      {/* On the body: inside a map pin's panel the viewer would sit under the page's own bars. */}
      {open && openAt != null && createPortal(
        <PhotoViewer
          key={open.id}
          kind={kind}
          photo={open}
          urls={urls}
          ownerName={ownerName}
          position={`${openAt + 1} of ${photos.length}`}
          onPrev={photos.length > 1 ? () => setOpenAt((openAt - 1 + photos.length) % photos.length) : undefined}
          onNext={photos.length > 1 ? () => setOpenAt((openAt + 1) % photos.length) : undefined}
          onClose={() => setOpenAt(null)}
          onRename={isManager ? (caption) => rename.mutate({ id: open.id, caption }) : undefined}
          onDelete={
            isManager
              ? async () => {
                  if (await askConfirm('Remove this photo?', { confirmLabel: 'Remove' })) {
                    remove.mutate(open)
                    setOpenAt(null)
                  }
                }
              : undefined
          }
        />,
        document.body,
      )}
    </div>
  )
}

function Thumb({ photo, urls, onOpen }: { photo: EquipmentPhotoMeta; urls: PhotoUrls; onOpen: () => void }) {
  const { src, isLoading } = usePhotoSrc(photo, urls)
  return (
    <button
      type="button"
      onClick={onOpen}
      title={photo.caption ?? 'Photo'}
      className="group block w-full overflow-hidden rounded-md border border-gray-200 bg-white text-left hover:border-brand-400"
    >
      <div className="flex aspect-[4/3] items-center justify-center bg-gray-100">
        {src ? (
          <img src={src} alt={photo.caption ?? 'Photo'} loading="lazy" className="h-full w-full object-cover" />
        ) : isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
        ) : null}
      </div>
      <p className="truncate px-1.5 py-1 text-[11px] text-gray-700 group-hover:text-brand-800">{photo.caption || 'Photo'}</p>
    </button>
  )
}

function PhotoViewer({
  kind,
  photo,
  urls,
  ownerName,
  position,
  onPrev,
  onNext,
  onClose,
  onRename,
  onDelete,
}: {
  kind: PhotoKind
  photo: EquipmentPhotoMeta
  urls: PhotoUrls
  ownerName: string
  position: string
  onPrev?: () => void
  onNext?: () => void
  onClose: () => void
  onRename?: (caption: string) => void
  onDelete?: () => void
}) {
  const { src, isLoading, error } = usePhotoSrc(photo, urls)
  const [editing, setEditing] = useState(false)
  const [caption, setCaption] = useState(photo.caption ?? '')
  const label = `${ownerName} — ${photo.caption || 'photo'}`
  return (
    <Modal title={label} onClose={onClose} wide>
      <div className="space-y-2">
        <div className="relative">
          {isLoading && <p className="py-10 text-center text-sm text-gray-400">Loading the photo…</p>}
          {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
          {src && <img src={src} alt={label} className="mx-auto max-h-[70dvh] w-auto rounded border border-gray-200" />}
          {onPrev && (
            <button type="button" onClick={onPrev} aria-label="Previous photo" className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-1.5 shadow hover:bg-white">
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          {onNext && (
            <button type="button" onClick={onNext} aria-label="Next photo" className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-1.5 shadow hover:bg-white">
              <ChevronRight className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
          {editing && onRename ? (
            <span className="flex flex-1 items-center gap-1">
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                autoFocus
                placeholder="What it shows, e.g. Motor nameplate"
                className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900"
              />
              <button
                type="button"
                onClick={() => {
                  onRename(caption)
                  setEditing(false)
                }}
                className="rounded bg-brand-700 px-2 py-1 font-semibold text-white"
              >
                Save
              </button>
              <button type="button" onClick={() => setEditing(false)} className="underline">
                cancel
              </button>
            </span>
          ) : (
            <span>
              {position}
              {` · added ${photo.created_at.slice(0, 10)}`}
            </span>
          )}
          <span className="flex items-center gap-3">
            {onRename && !editing && (
              <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1 text-gray-700 hover:underline">
                <Pencil className="h-3.5 w-3.5" /> Rename
              </button>
            )}
            {onDelete && (
              <button type="button" onClick={onDelete} className="flex items-center gap-1 text-red-600 hover:underline">
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            )}
            {src && (
              <button
                type="button"
                onClick={() => void savePhoto(src, (photo.filename ?? kind).replace(/\.\w+$/, '') + '.jpg')}
                className="font-medium text-brand-700 hover:underline"
              >
                Download
              </button>
            )}
          </span>
        </div>
      </div>
    </Modal>
  )
}
