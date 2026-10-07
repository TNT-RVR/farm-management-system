import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { groupPhotos } from './equipment-details'

/**
 * Photos of the irrigation equipment: pump_photos (nameplates, the pump, the
 * control panel) and pivot_photos (the pivot nameplate). Both keep a resized
 * JPEG the way scale tickets do; the lists here carry no images — each one is
 * fetched when it is opened, under a LIVE_ONLY key (src/lib/offline.ts) so it
 * is never saved on the device.
 */

export type EquipmentPhotoMeta = { id: string; caption: string | null; created_at: string }

export type PhotoKind = 'pump' | 'pivot'

export const PHOTO_TABLES = {
  pump: { table: 'pump_photos', owner: 'pump_id', indexKey: 'pump_photo_index', imageKey: 'pump-photo' },
  pivot: { table: 'pivot_photos', owner: 'pivot_id', indexKey: 'pivot_photo_index', imageKey: 'pivot-photo' },
} as const

/** Which photos each piece of equipment of this kind has, without the images. */
export function useEquipmentPhotoIndex(kind: PhotoKind) {
  const t = PHOTO_TABLES[kind]
  return useQuery({
    queryKey: [t.indexKey],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from(t.table).select(`id, ${t.owner}, caption, created_at`).order('created_at')
      if (error) throw error
      const rows = (data ?? []) as unknown as (EquipmentPhotoMeta & Record<string, string>)[]
      return groupPhotos(rows, (r) => r[t.owner])
    },
  })
}

/** Which photos each pump has, without the images (those are fetched when opened). */
export const usePumpPhotoIndex = () => useEquipmentPhotoIndex('pump')
/** Which photos each pivot has (keyed by field_pivots.id). */
export const usePivotPhotoIndex = () => useEquipmentPhotoIndex('pivot')
