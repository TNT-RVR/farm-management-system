import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

/**
 * A person's own profile picture. The photo is shrunk in the browser (a phone
 * photo is several MB) and kept beside the 256-pixel circle cut from it, so
 * the picture can be moved or zoomed again later without a fresh upload. Both
 * live under the person's own folder in the public "avatars" bucket; the
 * circle's address is saved on their users row. Old files go.
 */

/** The square of the source photo, in its own pixels, that becomes the circle. */
export type AvatarCrop = { x: number; y: number; side: number }

const toJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read that picture'))), 'image/jpeg', quality),
  )

/** A chosen photo, no longer than `max` on its long side, as a JPEG. */
export async function shrinkPhoto(file: Blob, max = 1600): Promise<Blob> {
  const img = await createImageBitmap(file)
  const k = Math.min(1, max / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * k)
  canvas.height = Math.round(img.height * k)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return toJpeg(canvas, 0.85)
}

async function cut(source: Blob, crop: AvatarCrop, size = 256): Promise<Blob> {
  const img = await createImageBitmap(source)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  canvas.getContext('2d')!.drawImage(img, crop.x, crop.y, crop.side, crop.side, 0, 0, size, size)
  return toJpeg(canvas, 0.88)
}

const pathOf = (url: string | null | undefined) => url?.split('/avatars/')[1]?.split('?')[0] ?? null
/** The kept photo beside a circle: <time>.jpg -> <time>-src.jpg. */
const sourcePathOf = (path: string) => path.replace(/\.jpg$/, '-src.jpg')

/** The photo the current circle was cut from, to adjust it; the circle itself if there is none. */
export async function loadAvatarSource(url: string): Promise<Blob> {
  const path = pathOf(url)
  if (path) {
    const r = await fetch(supabase.storage.from('avatars').getPublicUrl(sourcePathOf(path)).data.publicUrl)
    if (r.ok) return r.blob()
  }
  const r = await fetch(url)
  if (!r.ok) throw new Error('Could not load your picture')
  return r.blob()
}

export function useSetMyAvatar(userId: string | undefined, current: string | null | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (pick: { source: Blob; crop: AvatarCrop } | null) => {
      if (!userId) throw new Error('Sign in first')
      const bucket = supabase.storage.from('avatars')
      let url: string | null = null
      if (pick) {
        const path = `${userId}/${Date.now()}.jpg`
        const up = await bucket.upload(path, await cut(pick.source, pick.crop), { contentType: 'image/jpeg' })
        if (up.error) throw up.error
        const src = await bucket.upload(sourcePathOf(path), pick.source, { contentType: 'image/jpeg' })
        if (src.error) throw src.error
        url = bucket.getPublicUrl(path).data.publicUrl
      }
      const { error } = await supabase.from('users').update({ avatar_url: url }).eq('id', userId)
      if (error) throw error
      const old = pathOf(current)
      if (old) await bucket.remove([old, sourcePathOf(old)])
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] })
      void qc.invalidateQueries({ queryKey: ['profile'] })
    },
  })
}
