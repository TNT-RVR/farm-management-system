import { supabase } from './supabase'

/**
 * Photos and documents, kept on the device.
 *
 * The obvious approach — cache the URL the app already opens — does not work
 * here, and quietly. Storage objects are served through signed URLs that expire
 * after five minutes, so the URL is different on every open: caching a response
 * against it produces an entry that is never hit again, a cache that grows and
 * a screen that still cannot show the photo.
 *
 * So the blob is saved against the object's PATH, under a made-up URL on our
 * own origin that nothing is listening on. The service worker answers it from
 * the cache and never goes to the network for it, because there is nothing
 * there to go to.
 */

const BUCKET = 'field-files'
const FILE_CACHE = 'rvr-files'
const FILE_PREFIX = '/__offline-file/'

/** Stable key for a storage object. Slashes survive encodeURIComponent. */
export const offlineFileUrl = (storagePath: string) =>
  `${self.location.origin}${FILE_PREFIX}${encodeURIComponent(storagePath)}`

export type FileProgress = { done: number; total: number; failed: number; bytes: number }

/**
 * Save each file's contents.
 *
 * Two at a time: these are photographs rather than tiles, and a farm phone on
 * yard signal does better with a couple of large transfers than a dozen.
 */
export async function downloadFiles(
  paths: string[],
  onProgress?: (p: FileProgress) => void,
  signal?: AbortSignal,
): Promise<FileProgress> {
  const cache = await caches.open(FILE_CACHE)
  let done = 0
  let failed = 0
  let bytes = 0
  let cursor = 0

  const worker = async () => {
    while (cursor < paths.length) {
      if (signal?.aborted) return
      const path = paths[cursor++]
      const key = offlineFileUrl(path)
      try {
        if (!(await cache.match(key))) {
          const { data, error } = await supabase.storage.from(BUCKET).download(path)
          if (error || !data) throw error ?? new Error('no data')
          bytes += data.size
          await cache.put(
            key,
            new Response(data, {
              headers: {
                // Kept from the blob so the browser renders a PDF as a PDF and
                // a photo as a photo when the saved copy is opened.
                'Content-Type': data.type || 'application/octet-stream',
                'Content-Length': String(data.size),
              },
            }),
          )
        }
      } catch {
        failed++
      }
      done++
      onProgress?.({ done, total: paths.length, failed, bytes })
    }
  }

  await Promise.all(Array.from({ length: Math.min(2, paths.length) }, () => worker()))
  const final = { done, total: paths.length, failed, bytes }
  onProgress?.(final)
  return final
}

/** Is this file on the device? */
export async function hasCachedFile(storagePath: string): Promise<boolean> {
  if (!('caches' in globalThis)) return false
  const cache = await caches.open(FILE_CACHE)
  return Boolean(await cache.match(offlineFileUrl(storagePath)))
}

/**
 * A URL that will open this file, saved copy or not.
 *
 * Tries the signed URL first when there is a connection, because that is the
 * live copy and it is what the app has always done. Falls back to the saved
 * one — including when the signing request itself fails, which is what happens
 * on a connection weak enough to be worse than none.
 */
export async function resolveFileUrl(storagePath: string): Promise<string | null> {
  if (navigator.onLine) {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 300)
      if (!error && data?.signedUrl) return data.signedUrl
    } catch {
      // fall through to the saved copy
    }
  }
  return (await hasCachedFile(storagePath)) ? offlineFileUrl(storagePath) : null
}

export async function cachedFileCount(): Promise<number> {
  if (!('caches' in globalThis)) return 0
  const cache = await caches.open(FILE_CACHE)
  return (await cache.keys()).length
}

export async function clearFiles(): Promise<void> {
  await caches.delete(FILE_CACHE)
}
