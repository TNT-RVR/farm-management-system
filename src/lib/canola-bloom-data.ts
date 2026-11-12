import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import { cropShare, settingsFromRow, type BloomSettings } from './canola-bloom'

export type CanolaBloomRow = Database['public']['Tables']['canola_bloom']['Row']
export type BloomScoutingRow = Database['public']['Tables']['canola_bloom_scouting']['Row']
type SettingsUpdate = Database['public']['Tables']['canola_bloom_settings']['Update']

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
          .select('sensed_on, yellow_fraction, plant_fraction')
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
      // The share over the crop, as the bloom rule reads it.
      const yellowOn = new Map(
        (obs.data ?? []).map((o) => [
          o.sensed_on,
          cropShare({ sensedOn: o.sensed_on, yellow: Number(o.yellow_fraction), blue: null, plant: o.plant_fraction == null ? null : Number(o.plant_fraction) }),
        ]),
      )
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

/** The farm's bloom settings, as numbers. */
export function useBloomSettings() {
  return useQuery({
    queryKey: ['canola_bloom_settings'],
    queryFn: async (): Promise<BloomSettings> => {
      const { data, error } = await supabase.from('canola_bloom_settings').select('*').eq('id', 1).maybeSingle()
      if (error) throw error
      return settingsFromRow(data)
    },
  })
}

export function useSaveBloomSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: SettingsUpdate) => {
      const { error } = await supabase.from('canola_bloom_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['canola_bloom_settings'] }),
  })
}

/** "I saw it" reports on one field for a year. */
export function useBloomScouting(fieldId: string, cropYear: number) {
  return useQuery({
    queryKey: ['canola_bloom_scouting', fieldId, cropYear],
    queryFn: async (): Promise<BloomScoutingRow[]> => {
      const { data, error } = await supabase
        .from('canola_bloom_scouting')
        .select('*')
        .eq('field_id', fieldId)
        .eq('crop_year', cropYear)
        .order('seen_on', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

export function useAddBloomScouting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (r: { field_id: string; crop_year: number; seen_on: string; bloom_pct: number; note: string | null }) => {
      const { error } = await supabase.from('canola_bloom_scouting').insert(r)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['canola_bloom_scouting'] }),
  })
}

export function useDeleteBloomScouting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('canola_bloom_scouting').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['canola_bloom_scouting'] }),
  })
}

export type FarmBloomRow = CanolaBloomRow & { fieldName: string; yieldPerAcre: number | null; yieldUnit: string | null; scoutCount: number }

/**
 * Every canola field's bloom season, every year on file, with the field's
 * name, its canola yield where the books have one, and how many scouting
 * reports it got. The farm-wide page reads this.
 */
export function useFarmBloom() {
  return useQuery({
    queryKey: ['canola_bloom', 'farm'],
    queryFn: async (): Promise<FarmBloomRow[]> => {
      const [bloom, fields, crops, scouting] = await Promise.all([
        supabase.from('canola_bloom').select('*').order('crop_year', { ascending: false }),
        supabase.from('fields').select('id, name'),
        supabase.from('crops').select('id, name'),
        supabase.from('canola_bloom_scouting').select('field_id, crop_year'),
      ])
      for (const r of [bloom, fields, crops, scouting]) if (r.error) throw r.error
      const rows = bloom.data ?? []
      const canolaIds = (crops.data ?? []).filter((c) => /canola/i.test(c.name ?? '')).map((c) => c.id)
      const yields = rows.length && canolaIds.length
        ? await supabase
            .from('crop_yields_v')
            .select('field_id, crop_year, yield_per_acre, yield_unit')
            .in('field_id', [...new Set(rows.map((r) => r.field_id))])
            .in('crop_id', canolaIds)
        : { data: [], error: null }
      if (yields.error) throw yields.error
      const nameOf = new Map((fields.data ?? []).map((f) => [f.id, f.name as string]))
      const yieldOf = new Map<string, { y: number; u: string | null }>()
      for (const y of (yields.data ?? []) as { field_id: string; crop_year: number; yield_per_acre: number | string | null; yield_unit: string | null }[]) {
        if (y.yield_per_acre != null) yieldOf.set(`${y.field_id}|${y.crop_year}`, { y: Number(y.yield_per_acre), u: y.yield_unit })
      }
      const scouts = new Map<string, number>()
      for (const s of scouting.data ?? []) scouts.set(`${s.field_id}|${s.crop_year}`, (scouts.get(`${s.field_id}|${s.crop_year}`) ?? 0) + 1)
      return rows
        .map((r) => {
          const k = `${r.field_id}|${r.crop_year}`
          return { ...r, fieldName: nameOf.get(r.field_id) ?? 'Field', yieldPerAcre: yieldOf.get(k)?.y ?? null, yieldUnit: yieldOf.get(k)?.u ?? null, scoutCount: scouts.get(k) ?? 0 }
        })
        .sort((a, b) => b.crop_year - a.crop_year || a.fieldName.localeCompare(b.fieldName))
    },
  })
}
