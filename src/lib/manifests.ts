import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type Manifest = Database['public']['Tables']['cattle_manifests']['Row']
export type ManifestLine = Database['public']['Tables']['cattle_manifest_lines']['Row']
export type ManifestWithLines = Manifest & { lines: ManifestLine[] }

/** Why the cattle are moving — the box every manifest asks for. */
export const PURPOSES = [
  { value: 'sale', label: 'Sale' },
  { value: 'feeding', label: 'Feeding' },
  { value: 'pasture', label: 'Pasture' },
  { value: 'slaughter', label: 'Slaughter' },
  { value: 'exhibition', label: 'Exhibition' },
  { value: 'return', label: 'Return to owner' },
  { value: 'other', label: 'Other' },
]

export function useManifests(cropYear: number) {
  return useQuery({
    queryKey: ['cattle_manifests', cropYear],
    queryFn: async (): Promise<ManifestWithLines[]> => {
      const { data, error } = await supabase
        .from('cattle_manifests')
        .select('*')
        .eq('crop_year', cropYear)
        .order('moved_on', { ascending: false })
      if (error) throw error
      const ids = (data ?? []).map((m) => m.id)
      if (!ids.length) return []
      const { data: lines, error: lerr } = await supabase
        .from('cattle_manifest_lines')
        .select('*')
        .in('manifest_id', ids)
        .order('sort_order')
      if (lerr) throw lerr
      const byManifest = new Map<string, ManifestLine[]>()
      for (const l of lines ?? []) {
        const list = byManifest.get(l.manifest_id) ?? []
        list.push(l)
        byManifest.set(l.manifest_id, list)
      }
      return (data ?? []).map((m) => ({ ...m, lines: byManifest.get(m.id) ?? [] }))
    },
  })
}

export function useManifestMutations() {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['cattle_manifests'] })

  const save = useMutation({
    mutationFn: async (m: Database['public']['Tables']['cattle_manifests']['Insert']) => {
      const { data, error } = await supabase
        .from('cattle_manifests')
        .upsert({ ...m, updated_at: new Date().toISOString() })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cattle_manifests').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const saveLines = useMutation({
    mutationFn: async ({
      manifestId,
      lines,
    }: {
      manifestId: string
      lines: Omit<Database['public']['Tables']['cattle_manifest_lines']['Insert'], 'manifest_id'>[]
    }) => {
      // Replaced wholesale rather than diffed. A manifest's lines are read off
      // the chute in one go and re-typed in one go; matching them up row by row
      // would be machinery in aid of nothing.
      const { error: del } = await supabase
        .from('cattle_manifest_lines')
        .delete()
        .eq('manifest_id', manifestId)
      if (del) throw del
      if (!lines.length) return
      const { error } = await supabase
        .from('cattle_manifest_lines')
        .insert(lines.map((l, i) => ({ ...l, manifest_id: manifestId, sort_order: i })))
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  return { save, remove, saveLines }
}

/** Total head on a manifest — the number the brand inspector counts against. */
export function totalHead(lines: Pick<ManifestLine, 'head'>[]): number {
  return lines.reduce((s, l) => s + (l.head ?? 0), 0)
}

export type Gap = { field: string; why: string }

/**
 * What is still missing before this can be handed to anybody.
 *
 * Named rather than counted, because "3 fields missing" makes somebody hunt.
 * These are the ones a brand inspector or a buyer will actually stop over —
 * not every empty box on the form.
 */
export function missingFor(m: Partial<Manifest>, lines: Pick<ManifestLine, 'head'>[]): Gap[] {
  const gaps: Gap[] = []
  if (!m.moved_on) gaps.push({ field: 'Date', why: 'every manifest is dated' })
  if (!m.owner_name) gaps.push({ field: 'Owner', why: 'who the cattle belong to' })
  if (!m.origin_address && !m.origin_premises_id)
    gaps.push({ field: 'Where they left', why: 'an address or a premises ID' })
  if (!m.destination_name) gaps.push({ field: 'Destination', why: 'where they are going' })
  if (!m.purpose) gaps.push({ field: 'Purpose', why: 'sale, feeding, pasture and so on' })
  if (!m.brand) gaps.push({ field: 'Brand', why: 'the brand and where it sits' })
  if (totalHead(lines) === 0)
    gaps.push({ field: 'Livestock', why: 'at least one line with a head count' })
  if (!m.transporter_name && !m.licence_plate)
    gaps.push({ field: 'Transporter', why: 'who is hauling, or the plate' })
  return gaps
}
