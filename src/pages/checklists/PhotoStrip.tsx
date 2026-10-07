import { useRef, useState } from 'react'
import { Camera, Star, Trash2, X } from 'lucide-react'
import { useAuth, hasManagerAccess } from '@/lib/auth'
import { useAddPhoto, useDeletePhoto, usePhotoUrls, type ChecklistPhoto } from '@/lib/checklist-map'

/**
 * A row of photos with an add button. Template photos show how a place is
 * done; a year's photos show what was found. Tap one to see it large.
 */
export function PhotoStrip({
  photos,
  target,
  canAdd,
  label = 'Add photo',
  kept,
  onKeep,
}: {
  photos: ChecklistPhoto[]
  target: { templateLocationId?: string; runLocationId?: string }
  canAdd: boolean
  label?: string
  /** Files already on the template (a year's photo kept for next year). */
  kept?: Set<string>
  /** Offer "Keep for next year" on a photo. */
  onKeep?: (p: ChecklistPhoto) => void
}) {
  const { profile } = useAuth()
  const { data: urls } = usePhotoUrls(photos.map((p) => p.storage_path))
  const add = useAddPhoto()
  const del = useDeletePhoto()
  const input = useRef<HTMLInputElement>(null)
  const [big, setBig] = useState<ChecklistPhoto | null>(null)
  const canDelete = (p: ChecklistPhoto) => hasManagerAccess(profile?.role) || p.created_by === profile?.id

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <button key={p.id} onClick={() => setBig(p)} className="relative h-20 w-20 overflow-hidden rounded-md border border-gray-200 bg-gray-100">
            {urls?.[p.storage_path] ? <img src={urls[p.storage_path]} alt={p.caption ?? ''} className="h-full w-full object-cover" /> : null}
            {kept?.has(p.storage_path) && (
              <span className="absolute bottom-0.5 left-0.5 rounded bg-brand-700/90 px-1 text-[9px] font-semibold text-white">next year</span>
            )}
          </button>
        ))}
        {canAdd && (
          <button
            onClick={() => input.current?.click()}
            disabled={add.isPending}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-gray-300 text-[11px] text-gray-500 hover:bg-gray-50 disabled:opacity-50"
          >
            <Camera className="h-5 w-5" />
            {add.isPending ? 'Uploading…' : label}
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => {
          for (const file of Array.from(e.target.files ?? [])) add.mutate({ file, ...target })
          e.target.value = ''
        }}
      />
      {add.isError && <p className="mt-1 text-xs text-red-600">{(add.error as Error).message}</p>}
      {big && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setBig(null)}>
          <img src={urls?.[big.storage_path]} alt={big.caption ?? ''} className="max-h-full max-w-full rounded" />
          <div className="absolute right-4 top-4 flex gap-2">
            {onKeep && !kept?.has(big.storage_path) && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onKeep(big)
                }}
                className="flex items-center gap-1 rounded-full bg-white/90 px-3 py-2 text-sm font-semibold text-brand-800"
              >
                <Star className="h-4 w-4" /> Keep for next year
              </button>
            )}
            {canDelete(big) && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (window.confirm('Delete this photo?')) {
                    del.mutate(big)
                    setBig(null)
                  }
                }}
                className="rounded-full bg-white/90 p-2 text-red-600"
                aria-label="Delete photo"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            )}
            <button className="rounded-full bg-white/90 p-2 text-gray-800" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
