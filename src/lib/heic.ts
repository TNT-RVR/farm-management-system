/**
 * HEIC photos (Sam, 23 Oct 2026): a Samsung or iPhone gallery keeps photos
 * as HEIC, which Chrome on Android can neither show nor shrink, so a scale
 * photo picked from the gallery showed as a broken picture. Turned into a
 * JPEG on the phone; the converter (heic2any, MIT) is only downloaded when a
 * HEIC photo turns up.
 */

/** A HEIC/HEIF picture, by its type or, when the phone gives none, its name. */
export function isHeic(blob: Blob, name?: string): boolean {
  const t = (blob.type || '').toLowerCase()
  if (t === 'image/heic' || t === 'image/heif') return true
  return !t && !!name && /\.(heic|heif)$/i.test(name)
}

/** The picture as a JPEG. */
export async function heicToJpeg(blob: Blob): Promise<Blob> {
  const { default: heic2any } = await import('heic2any')
  const out = await heic2any({ blob, toType: 'image/jpeg', quality: 0.85 })
  return Array.isArray(out) ? out[0] : out
}

/** A picked file, as a JPEG file when it was HEIC; anything else as it is. */
export async function viewableFile(file: File): Promise<File> {
  if (!isHeic(file, file.name)) return file
  const jpeg = await heicToJpeg(file)
  return new File([jpeg], file.name.replace(/\.(heic|heif)$/i, '') + '.jpg', { type: 'image/jpeg' })
}
