import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type CanolaBloomRow = Database['public']['Tables']['canola_bloom']['Row']

/** This field's flowering season, kept by the satellite run. Null for a field that is not canola that year. */
export function useCanolaBloom(fieldId: string, cropYear: number) {
  return useQuery({
    queryKey: ['canola_bloom', fieldId, cropYear],
    queryFn: async (): Promise<CanolaBloomRow | null> => {
      const { data, error } = await supabase
        .from('canola_bloom')
        .select('*')
        .eq('field_id', fieldId)
        .eq('crop_year', cropYear)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export type BloomPicture = {
  sensedOn: string
  /** Share of the field yellow on that look, 0-1, when it was scored. */
  yellow: number | null
  photo: string | null
  flowers: string | null
  /** Width over height of the ground the pictures cover. */
  aspect: number
}

/**
 * The summer's pictures, June to August: the photograph and the flower map of
 * each day, with that day's yellow share. Signed links last an hour, so this is
 * never kept on the device (offline.ts LIVE_ONLY).
 */
export function useBloomPictures(fieldId: string, cropYear: number, enabled: boolean) {
  return useQuery({
    queryKey: ['canola-bloom-pictures', fieldId, cropYear],
    enabled,
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<BloomPicture[]> => {
      const from = `${cropYear}-06-01`
      const to = `${cropYear}-08-31`
      const [imgs, obs] = await Promise.all([
        supabase
          .from('sat_images')
          .select('sensed_on, kind, storage_path, west, south, east, north')
          .eq('subject_type', 'field')
          .eq('subject_id', fieldId)
          .in('kind', ['truecolour', 'yellow'])
          .gte('sensed_on', from)
          .lte('sensed_on', to),
        supabase
          .from('sat_observations')
          .select('sensed_on, yellow_fraction')
          .eq('subject_type', 'field')
          .eq('subject_id', fieldId)
          .eq('zone_id', '00000000-0000-0000-0000-000000000000')
          .gte('sensed_on', from)
          .lte('sensed_on', to)
          .not('yellow_fraction', 'is', null),
      ])
      if (imgs.error) throw imgs.error
      if (obs.error) throw obs.error
      const rows = imgs.data ?? []
      if (!rows.length) return []
      const { data: signed, error } = await supabase.storage
        .from('satellite-images')
        .createSignedUrls(rows.map((r) => r.storage_path), 3600)
      if (error) throw error
      const url = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]))
      const yellowOn = new Map((obs.data ?? []).map((o) => [o.sensed_on, Number(o.yellow_fraction)]))
      const byDay = new Map<string, BloomPicture>()
      for (const r of rows) {
        const midLat = ((Number(r.south) + Number(r.north)) / 2) * (Math.PI / 180)
        const aspect = ((Number(r.east) - Number(r.west)) * Math.cos(midLat)) / (Number(r.north) - Number(r.south)) || 1
        const p = byDay.get(r.sensed_on) ?? { sensedOn: r.sensed_on, yellow: yellowOn.get(r.sensed_on) ?? null, photo: null, flowers: null, aspect }
        if (r.kind === 'truecolour') p.photo = url.get(r.storage_path) ?? null
        else p.flowers = url.get(r.storage_path) ?? null
        byDay.set(r.sensed_on, p)
      }
      return [...byDay.values()].filter((p) => p.photo).sort((a, b) => a.sensedOn.localeCompare(b.sensedOn))
    },
  })
}
