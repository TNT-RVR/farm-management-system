import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

/**
 * Photos kept as files in Storage (26 Oct 2026): pump and pivot photos in
 * equipment-photos, scale ticket photos in scale-ticket-photos. The row keeps
 * the file's path (storage_path); the old base64 copies were moved and the
 * column dropped the same day.
 *
 * The signed links expire, so their query key is LIVE_ONLY in offline.ts
 * ('photo-urls'): a link restored from the device would be a broken image.
 */

export const EQUIPMENT_PHOTO_BUCKET = 'equipment-photos'
export const TICKET_PHOTO_BUCKET = 'scale-ticket-photos'
export type PhotoBucket = typeof EQUIPMENT_PHOTO_BUCKET | typeof TICKET_PHOTO_BUCKET

/** Signed links last an hour; the query refreshes them well before that. */
const LINK_SECONDS = 3600

/** A JPEG's base64 (as shrinkPhoto gives it) as a file to upload. */
export function b64ToBlob(b64: string, mime = 'image/jpeg'): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** Upload one photo; returns its path. */
export async function uploadPhoto(bucket: PhotoBucket, path: string, b64: string): Promise<string> {
  const { error } = await supabase.storage.from(bucket).upload(path, b64ToBlob(b64), { contentType: 'image/jpeg' })
  if (error) throw new Error(`Photo would not upload: ${error.message}`)
  return path
}

/** Signed links for a set of photos in one call, by path. */
export function usePhotoUrls(bucket: PhotoBucket, paths: string[]) {
  return useQuery({
    queryKey: ['photo-urls', bucket, paths],
    enabled: paths.length > 0,
    staleTime: 50 * 60_000,
    gcTime: 10 * 60_000,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, LINK_SECONDS)
      if (error) throw error
      const out = new Map<string, string>()
      for (const d of data ?? []) if (d.signedUrl && d.path) out.set(d.path, d.signedUrl)
      return out
    },
  })
}

/** Save a photo (signed link or data URL) as a file: a link to another site ignores the download attribute. */
export async function savePhoto(src: string, filename: string) {
  const blob = await (await fetch(src)).blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
