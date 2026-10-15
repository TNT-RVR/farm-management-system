import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type Camera = Database['public']['Tables']['cameras']['Row']
export type CameraKind = Camera['kind']

/**
 * What each kind means, in the terms someone choosing a camera needs.
 *
 * No brand is chosen yet, so this is the list of things a browser can actually
 * display — worth checking a camera against before buying one.
 */
export const CAMERA_KINDS: { value: CameraKind; label: string; hint: string }[] = [
  {
    value: 'snapshot',
    label: 'Still image',
    hint: 'A JPEG the camera serves on request, refreshed on a timer. Works almost everywhere.',
  },
  {
    value: 'mjpeg',
    label: 'MJPEG stream',
    hint: 'Motion JPEG. Plays as a live picture with no extra software.',
  },
  {
    value: 'hls',
    label: 'HLS stream (.m3u8)',
    hint: 'Plays natively on iPhone and Safari. Other browsers need a player library adding.',
  },
  {
    value: 'embed',
    label: "Vendor's own page",
    hint: "The camera maker's viewer in a frame. Some vendors block being framed.",
  },
]

export function useCameras(includeInactive = false) {
  return useQuery({
    queryKey: ['cameras', includeInactive],
    queryFn: async () => {
      let q = supabase.from('cameras').select('*').order('sort_order').order('name')
      if (!includeInactive) q = q.eq('active', true)
      const { data, error } = await q
      if (error) throw error
      return data
    },
  })
}

export function useSaveCamera() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      row: Database['public']['Tables']['cameras']['Insert'] & { id?: string },
    ) => {
      const { id, ...rest } = row
      // `updated_at` belongs to an update; on insert the column default sets it.
      const { error } = id
        ? await supabase
            .from('cameras')
            .update({ ...rest, updated_at: new Date().toISOString() })
            .eq('id', id)
        : await supabase.from('cameras').insert(rest)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cameras'] }),
  })
}

export function useDeleteCamera() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cameras').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cameras'] }),
  })
}

/**
 * A snapshot URL with a cache-buster, so the browser re-fetches instead of
 * showing the same frame forever.
 *
 * `tick` is passed in rather than read from the clock here: a component that
 * called Date.now() while rendering would be impure and could show a different
 * frame on every unrelated re-render.
 */
export function snapshotUrl(url: string, tick: number): string {
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}_t=${tick}`
}

/**
 * Whether the app can show this camera at all.
 *
 * RTSP is the common case worth catching: it is what most farm cameras
 * advertise, and no browser can play it. Saying so plainly beats a tile that
 * silently stays black.
 */
export function playbackProblem(c: Pick<Camera, 'kind' | 'stream_url'>): string | null {
  const url = (c.stream_url ?? '').trim()
  if (!url) return 'No address set yet'
  if (/^rtsp:/i.test(url)) {
    return 'No browser can play RTSP. This camera needs a bridge that republishes it as HLS.'
  }
  if (/^http:/i.test(url) && typeof window !== 'undefined' && window.location.protocol === 'https:') {
    // A browser on an https page refuses to load http sub-resources outright.
    return 'This is an http address, and the app runs on https — the browser will block it.'
  }
  return null
}
