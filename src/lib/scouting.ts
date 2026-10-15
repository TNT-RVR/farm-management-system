import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

/**
 * The scouting log: a pin per thing seen in a field — a kochia patch, flea
 * beetles on the headland, sclerotinia in the low spot — with how bad it was
 * and a photo, so next year's plan and this week's spray both start from what
 * was actually out there.
 */
export type ScoutNote = Database['public']['Tables']['scouting_notes']['Row']
export type ScoutCategory = ScoutNote['category']

const BUCKET = 'scouting-photos'

export const SCOUT_CATEGORIES: { value: ScoutCategory; label: string; colour: string }[] = [
  { value: 'weed', label: 'Weed', colour: '#16a34a' },
  { value: 'insect', label: 'Insect', colour: '#ea580c' },
  { value: 'disease', label: 'Disease', colour: '#7c3aed' },
  { value: 'other', label: 'Other', colour: '#0284c7' },
]
export const SEVERITY = ['', 'Light', 'Moderate', 'Heavy'] as const

/** Common things to pick from, per category; anything else is typed. */
export const SCOUT_SUBJECTS: Record<ScoutCategory, string[]> = {
  weed: ['Kochia', 'Wild oats', 'Cleavers', 'Wild buckwheat', 'Lamb’s quarters', 'Redroot pigweed', 'Canada thistle', 'Green foxtail', 'Volunteer canola', 'Russian thistle'],
  insect: ['Flea beetles', 'Cutworms', 'Grasshoppers', 'Diamondback moth', 'Bertha armyworm', 'Lygus bugs', 'Aphids', 'Wheat midge', 'Wireworms', 'Colorado potato beetle'],
  disease: ['Sclerotinia', 'Blackleg', 'Clubroot', 'Fusarium head blight', 'Stripe rust', 'Leaf spot', 'White mould', 'Bacterial blight', 'Late blight', 'Ergot'],
  other: ['Hail damage', 'Water damage', 'Wildlife', 'Nutrient deficiency', 'Herbicide injury', 'Salinity'],
}

export function useScoutNotes(cropYear: number) {
  return useQuery({
    queryKey: ['scouting-notes', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase.from('scouting_notes').select('*').eq('crop_year', cropYear).order('observed_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

/** Every scouting note on one field, all years, newest first. */
export function useFieldScoutNotes(fieldId: string) {
  return useQuery({
    queryKey: ['scouting-notes', 'field', fieldId],
    queryFn: async () => {
      const { data, error } = await supabase.from('scouting_notes').select('*').eq('field_id', fieldId).order('observed_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

/** Phone photos are 4–12 MB; 1600 px JPEG is plenty to tell kochia from pigweed. */
export async function shrinkPhoto(file: File, maxPx = 1600): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82))
    return blob ?? file
  } catch {
    return file
  }
}

export type NewScoutNote = Database['public']['Tables']['scouting_notes']['Insert'] & { photos?: File[] }

export function useSaveScoutNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ photos, ...row }: NewScoutNote) => {
      const paths: string[] = []
      for (const f of photos ?? []) {
        const blob = await shrinkPhoto(f)
        const path = `${row.crop_year ?? new Date().getFullYear()}/${crypto.randomUUID()}.jpg`
        const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
        if (error) throw new Error(`Photo would not upload: ${error.message}`)
        paths.push(path)
      }
      const { data, error } = await supabase
        .from('scouting_notes')
        .insert({ ...row, photo_paths: paths })
        .select()
        .single()
      if (error) {
        if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
        throw error
      }
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scouting-notes'] }),
  })
}

export function useUpdateScoutNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Database['public']['Tables']['scouting_notes']['Update']) => {
      const { error } = await supabase.from('scouting_notes').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scouting-notes'] }),
  })
}

export function useDeleteScoutNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (note: ScoutNote) => {
      const { error } = await supabase.from('scouting_notes').delete().eq('id', note.id)
      if (error) throw error
      if (note.photo_paths.length) await supabase.storage.from(BUCKET).remove(note.photo_paths)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scouting-notes'] }),
  })
}

/** Short-lived links for a note's photos. Not cached to disk: they expire. */
export function useScoutPhotoUrls(paths: string[]) {
  return useQuery({
    queryKey: ['scouting-photo-urls', paths],
    enabled: paths.length > 0,
    staleTime: 240_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 300)
      if (error) throw error
      return (data ?? []).map((d) => d.signedUrl).filter(Boolean) as string[]
    },
  })
}
