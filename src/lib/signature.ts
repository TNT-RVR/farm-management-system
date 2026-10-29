/**
 * Each person's own signature, drawn once on My account and used to sign forms
 * (Corteva's seed report first). Only ever readable by its owner: a signed form
 * keeps its own copy of the image, so others see it there and nowhere else.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAuth } from './auth'

const KEY = ['my_signature'] as const

export function useMySignature() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: [...KEY, profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('user_signatures').select('image, updated_at').eq('user_id', profile!.id).maybeSingle()
      if (error) throw error
      return data ?? null
    },
  })
}

export function useSaveMySignature() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (image: string) => {
      if (!profile?.id) throw new Error('Not signed in')
      const { error } = await supabase.from('user_signatures').upsert({ user_id: profile.id, image, updated_at: new Date().toISOString() })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeleteMySignature() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!profile?.id) throw new Error('Not signed in')
      const { error } = await supabase.from('user_signatures').delete().eq('user_id', profile.id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  })
}

/**
 * The ink on a drawing canvas as a PNG, cropped to the strokes with a little
 * margin and scaled down to at most 600 px wide: small enough to keep, sharp
 * enough to print at a signature line's size. Null when nothing was drawn.
 */
export function trimmedSignature(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const { width, height } = canvas
  const px = ctx.getImageData(0, 0, width, height).data
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] > 20) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  const pad = 8
  x0 = Math.max(0, x0 - pad)
  y0 = Math.max(0, y0 - pad)
  x1 = Math.min(width - 1, x1 + pad)
  y1 = Math.min(height - 1, y1 + pad)
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const scale = Math.min(1, 600 / w)
  const out = document.createElement('canvas')
  out.width = Math.round(w * scale)
  out.height = Math.round(h * scale)
  out.getContext('2d')!.drawImage(canvas, x0, y0, w, h, 0, 0, out.width, out.height)
  return out.toDataURL('image/png')
}

/**
 * A picture of a signature (a photo or scan of it on paper) made ready to
 * keep: the paper made transparent, the ink dark, cropped to the ink, at most
 * 600 px wide, as a PNG data URL (Sam, 20 Oct 2026: "import a file for
 * their signature"). The cut-off between paper and ink comes from the picture
 * itself, so a photo in poor light with grey paper still comes out clean.
 */
export async function signatureFromPicture(file: Blob): Promise<string> {
  const png = await cleanSignature(await createImageBitmap(file))
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Could not read that picture'))
    r.readAsDataURL(png)
  })
  // The table keeps a signature under 400,000 characters.
  if (url.length >= 400000) throw new Error('That picture is too detailed to keep as a signature; try a closer, plainer photo')
  return url
}

async function cleanSignature(source: CanvasImageSource & { width: number; height: number }): Promise<Blob> {
  // A phone photo is 4000 px across; 1600 is plenty for a signature.
  const k0 = Math.min(1, 1600 / Math.max(source.width, source.height))
  const w = Math.max(1, Math.round(source.width * k0))
  const h = Math.max(1, Math.round(source.height * k0))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source, 0, 0, w, h)
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  // Where paper ends and ink starts, from the picture itself: paper is most
  // of it, so the average is about the paper's shade. A photo in poor light
  // has grey paper, which a fixed cut-off would keep as a grey box.
  let sum = 0
  for (let i = 0; i < d.length; i += 4) sum += d[i + 3] === 0 ? 255 : 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
  const threshold = Math.min(200, (sum / (d.length / 4)) * 0.72)
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      // How dark, counting a transparent pixel as paper.
      const lum = d[i + 3] === 0 ? 255 : 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      if (lum >= threshold) {
        d[i + 3] = 0
        continue
      }
      // Darker ink is more solid; faint edges fade, so strokes stay smooth.
      d[i] = d[i + 1] = d[i + 2] = 20
      d[i + 3] = Math.round(255 * Math.min(1, (threshold - lum) / (threshold * 0.6)))
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) throw new Error('No signature found in that picture')
  ctx.putImageData(img, 0, 0)
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.04) + 2
  const sx = Math.max(0, minX - pad)
  const sy = Math.max(0, minY - pad)
  const sw = Math.min(w, maxX + pad + 1) - sx
  const sh = Math.min(h, maxY + pad + 1) - sy
  const k = Math.min(1, 600 / sw)
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(sw * k))
  out.height = Math.max(1, Math.round(sh * k))
  out.getContext('2d')!.drawImage(c, sx, sy, sw, sh, 0, 0, out.width, out.height)
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the signature'))), 'image/png'))
}

/** A signature ready to print: a PNG data URL and its size in pixels. */
export type SignatureImage = { dataUrl: string; width: number; height: number }

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Your own signature, for a form that names you as its signer (the manifest's
 * owner or agent, the stock return's holder). Null when the form names
 * someone else: only the person themselves signs with their signature, the
 * same rule the seed report keeps.
 */
export async function myNamedSignature(name: string | null | undefined): Promise<SignatureImage | null> {
  if (!norm(name)) return null
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabase.from('users').select('full_name').eq('id', user.id).maybeSingle()
  if (!me || norm(me.full_name) !== norm(name)) return null
  const { data } = await supabase.from('user_signatures').select('image').eq('user_id', user.id).maybeSingle()
  if (!data?.image) return null
  const bmp = await createImageBitmap(await (await fetch(data.image)).blob())
  return { dataUrl: data.image, width: bmp.width, height: bmp.height }
}

/** For a page: your signature when the form names you, else null. */
export function useMyNamedSignature(name: string | null | undefined) {
  return useQuery({
    queryKey: [...KEY, 'named', norm(name)],
    queryFn: () => myNamedSignature(name),
    enabled: !!norm(name),
    staleTime: 5 * 60_000,
  })
}
