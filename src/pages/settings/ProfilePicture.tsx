import { useRef, useState } from 'react'
import { Camera, Move, Trash2 } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { loadAvatarSource, shrinkPhoto, useSetMyAvatar } from '@/lib/avatar'
import { UserAvatar } from '@/components/UserAvatar'
import { AvatarCropper } from './AvatarCropper'
import { askConfirm } from '@/components/askConfirm'

/** Your own picture: shown top right while you are in the app, and on your tasks. */
export function ProfilePicture() {
  const { profile } = useAuth()
  const set = useSetMyAvatar(profile?.id, profile?.avatar_url)
  const input = useRef<HTMLInputElement>(null)
  // The photo being fitted into the circle, new or the current one.
  const [fitting, setFitting] = useState<Blob | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  if (!profile) return null

  const open = (p: Promise<Blob>) => {
    setLoadError(null)
    p.then(setFitting, (e: Error) => setLoadError(e.message))
  }
  const btn =
    'inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50'

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <UserAvatar person={profile} size="lg" />
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={set.isPending} onClick={() => input.current?.click()} className={btn}>
            <Camera className="h-4 w-4" /> {profile.avatar_url ? 'Change picture' : 'Add a picture'}
          </button>
          {profile.avatar_url && (
            <button type="button" disabled={set.isPending} onClick={() => open(loadAvatarSource(profile.avatar_url!))} className={btn}>
              <Move className="h-4 w-4" /> Adjust
            </button>
          )}
        </div>
        {profile.avatar_url && (
          <button
            type="button"
            disabled={set.isPending}
            onClick={async () => await askConfirm('Remove your picture?', { confirmLabel: 'Remove' }) && set.mutate(null)}
            className="inline-flex items-center gap-1 self-start text-xs text-gray-500 hover:text-red-700"
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </button>
        )}
        {(loadError || (!fitting && set.error)) && (
          <span className="text-xs text-red-600">{loadError ?? (set.error as Error).message}</span>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) open(shrinkPhoto(f))
          e.target.value = ''
        }}
      />
      {fitting && (
        <AvatarCropper
          source={fitting}
          saving={set.isPending}
          error={set.error ? (set.error as Error).message : undefined}
          onCancel={() => {
            set.reset()
            setFitting(null)
          }}
          onSave={(crop) => set.mutate({ source: fitting, crop }, { onSuccess: () => setFitting(null) })}
        />
      )}
    </div>
  )
}
