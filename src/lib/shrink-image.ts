/**
 * A phone photo or screenshot is 1–3 MB; the readers take 8 MB and the model
 * reads a 1600-pixel image as well as a full-size one. Shrunk to a JPEG before
 * it is sent, so the person at the scale is not waiting on their own upload.
 *
 * Only for images on their way to be READ. A photo being kept is uploaded as
 * it was taken.
 */
export async function shrinkForReading(file: Blob, max = 1600): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9))
    return out ?? file
  } catch {
    return file
  }
}
