import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type SampleSite = Database['public']['Tables']['soil_sample_sites']['Row']

/**
 * Every sample site, all years.
 *
 * Not filtered by year in the query: a benchmark site has a null crop_year and
 * belongs to every year, and a site marked in 2024 is still the place you go
 * back to in 2026. Which ones to draw is a decision for the screen, made below
 * in sitesForYear.
 */
export function useSampleSites() {
  return useQuery({
    queryKey: ['soil_sample_sites'],
    queryFn: async (): Promise<SampleSite[]> => {
      const { data, error } = await supabase
        .from('soil_sample_sites')
        .select('*')
        .eq('active', true)
        .order('code')
      if (error) throw error
      return data ?? []
    },
  })
}

/**
 * The sites that apply to a year.
 *
 * A site pinned to a year shows in that year only. A site with no year is a
 * benchmark — the same spot every season — and shows always. A field that has
 * both keeps the year-specific one, because somebody who bothered to date a
 * site meant that year's sampling and not the standing benchmark.
 */
export function sitesForYear(sites: SampleSite[], year: number): SampleSite[] {
  const dated = sites.filter((s) => s.crop_year === year)
  const claimed = new Set(dated.map((s) => `${s.field_id}:${s.code}`))
  const benchmarks = sites.filter(
    (s) => s.crop_year == null && !claimed.has(`${s.field_id}:${s.code}`),
  )
  return [...dated, ...benchmarks]
}

export function useSampleSiteMutations() {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['soil_sample_sites'] })

  const add = useMutation({
    mutationFn: async (v: {
      field_id: string
      code: string
      lat: number
      lng: number
      crop_year: number | null
    }) => {
      const { error } = await supabase.from('soil_sample_sites').insert(v)
      if (error) {
        if ((error as { code?: string }).code === '23505')
          throw new Error(`This field already has a site called ${v.code} for that year.`)
        throw error
      }
    },
    onSuccess: invalidate,
  })

  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Database['public']['Tables']['soil_sample_sites']['Update']
    }) => {
      const { error } = await supabase
        .from('soil_sample_sites')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) {
        if ((error as { code?: string }).code === '23505')
          throw new Error('Another site in this field already uses that code.')
        throw error
      }
    },
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('soil_sample_sites').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  return { add, update, remove }
}

/**
 * The next code to suggest for a field.
 *
 * Numeric where the field is already using numbers, which is what the lab
 * reports use, and it means dropping five pins in a row needs no typing.
 */
export function nextCode(existing: string[]): string {
  const numbers = existing.map((c) => Number(c.trim())).filter((n) => Number.isInteger(n) && n > 0)
  return String((numbers.length ? Math.max(...numbers) : 0) + 1)
}
