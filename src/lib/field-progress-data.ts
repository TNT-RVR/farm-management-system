import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { ProgressField } from './fieldProgress'

/**
 * field_season_progress for a crop year: the acres, what is seeded, what is
 * harvested and what the scale knows about each field.
 *
 * Shared by Seeding & harvest progress and by the Fields list's state column,
 * on one query key so the second page costs nothing (Sam, 29 Oct 2026).
 */

type Row = {
  field_id: string
  field_name: string
  crop_year: number
  acres: number
  crop_name: string | null
  counts_for_seeding: boolean
  counts_for_harvest: boolean
  progress_note: string | null
  has_seeding: boolean
  has_harvest: boolean
  has_any_operation: boolean
  harvest_started: boolean
  harvest_finished: boolean
  last_load_on: string | null
  loads: number
}

export function seasonProgressQuery(year: number) {
  return {
    queryKey: ['field_season_progress', year],
    queryFn: async (): Promise<ProgressField[]> => {
      const { data, error } = await supabase
        .from('field_season_progress')
        .select('*')
        .eq('crop_year', year)
      if (error) throw error
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        fieldId: r.field_id,
        name: r.field_name,
        acres: Number(r.acres),
        cropName: r.crop_name,
        countsForSeeding: r.counts_for_seeding,
        countsForHarvest: r.counts_for_harvest,
        progressNote: r.progress_note,
        hasSeeding: r.has_seeding,
        hasHarvest: r.has_harvest,
        hasAnyOperation: r.has_any_operation,
        harvestStarted: r.harvest_started,
        harvestFinished: r.harvest_finished,
        lastLoadOn: r.last_load_on,
        loads: Number(r.loads ?? 0),
      }))
    },
  }
}

export function useSeasonProgress(year: number) {
  return useQuery(seasonProgressQuery(year))
}

/** By field id, for a page that has a field in hand and wants its state. */
export function progressByField(rows: ProgressField[] | undefined) {
  return new Map((rows ?? []).map((r) => [r.fieldId, r]))
}
