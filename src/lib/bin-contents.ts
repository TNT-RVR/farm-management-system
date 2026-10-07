import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

/**
 * What is actually sitting in a bin, including last year's grain.
 *
 * The case that prompted it: #2 still has durum in it from last season.
 * Nothing in the app knew, so the estimator counted #2 as empty and available —
 * which is the one number that page exists to get right.
 *
 * CARRY-OVER IS DERIVED, NOT STORED. A row knows which season its grain was
 * grown in; whether that makes it carry-over depends on the year being asked
 * about. A flag would have to be cleared on every bin each spring, and the
 * first year somebody forgot, the estimator would go quietly back to being
 * wrong in exactly the way it is now.
 */
export type BinContent = {
  id: string
  bin_id: string
  bin_name: string
  site: string | null
  capacity_bu: number
  crop_id: string | null
  crop_name: string | null
  variety: string | null
  crop_year: number
  bushels: number | null
  note: string | null
  filled_on: string | null
}

export function binContentsQuery() {
  return {
    queryKey: ['bin_contents_current'],
    queryFn: async (): Promise<BinContent[]> => {
      const { data, error } = await supabase.from('bin_contents_current').select('*')
      if (error) throw error
      return (data ?? []).map((r) => {
        const row = r as unknown as Record<string, unknown>
        return {
          id: String(row.id),
          bin_id: String(row.bin_id),
          bin_name: String(row.bin_name),
          site: (row.site as string) ?? null,
          capacity_bu: Number(row.capacity_bu),
          crop_id: (row.crop_id as string) ?? null,
          crop_name: (row.crop_name as string) ?? null,
          variety: (row.variety as string) ?? null,
          crop_year: Number(row.crop_year),
          bushels: row.bushels == null ? null : Number(row.bushels),
          note: (row.note as string) ?? null,
          filled_on: (row.filled_on as string) ?? null,
        }
      })
    },
  }
}

/** Only bins with something in them — an empty bin has no row. */
export function useBinContents() {
  return useQuery(binContentsQuery())
}

/** Grain grown before the year being planned is carry-over. */
export function isCarryOver(content: Pick<BinContent, 'crop_year'>, cropYear: number): boolean {
  return content.crop_year < cropYear
}

/** "2025 Durum — about 3,200 bu", for a bin row. */
export function contentLabel(c: BinContent): string {
  const what = c.crop_name ?? 'Grain'
  const how = c.bushels != null ? ` — about ${Math.round(c.bushels).toLocaleString('en-CA')} bu` : ''
  return `${c.crop_year} ${what}${how}`
}

export function useSaveBinContent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      id?: string
      bin_id: string
      crop_id: string | null
      variety: string | null
      crop_year: number
      bushels: number | null
      note: string | null
      filled_on: string | null
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const patch = { ...v, updated_at: new Date().toISOString(), updated_by: user?.id ?? null }
      const { id, ...rest } = patch
      const { error } = id
        ? await supabase.from('bin_contents').update(rest).eq('id', id)
        : await supabase.from('bin_contents').insert(rest)
      // One open row per bin is enforced by a unique index, so a second fill on
      // an occupied bin is refused rather than quietly making the bin hold two
      // things — which would put the estimator back where it started.
      if (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new Error('That bin already has something in it. Empty it first.')
        }
        throw error
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bin_contents_current'] })
    },
  })
}

/** Close the row out. The bin is free from this date; the row stays as history. */
export function useEmptyBin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, on }: { id: string; on?: string }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('bin_contents')
        .update({
          emptied_on: on ?? new Date().toISOString().slice(0, 10),
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bin_contents_current'] }),
  })
}

/**
 * Take a record out altogether — one typed against the wrong bin, say. A bin
 * that has been emptied is closed with useEmptyBin instead, which keeps the
 * row as history.
 */
export function useDeleteBinContent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('bin_contents').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bin_contents_current'] }),
  })
}

/**
 * Every crop, for saying what is in a bin: this year's first, then the rest.
 *
 * "Active" means grown this year, but a bin can hold anything grown before —
 * last year's durum — so the list cannot stop at what is active.
 */
export function binCropOptions(
  crops: { id: string; name: string; active: boolean }[],
): { value: string; label: string; disabled?: boolean }[] {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
  const now = crops.filter((c) => c.active).sort(byName)
  const before = crops.filter((c) => !c.active).sort(byName)
  return [
    ...now.map((c) => ({ value: c.id, label: c.name })),
    ...(before.length ? [{ value: '__before', label: '— Not grown this year —', disabled: true }] : []),
    ...before.map((c) => ({ value: c.id, label: c.name })),
  ]
}
