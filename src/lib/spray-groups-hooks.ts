import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { FieldSoil, MoaPass, ProductMoa } from './spray-groups'

/**
 * The three reads behind the spray check's group warnings.
 *
 * Separate from spray-groups.ts so the rules there stay pure and testable. All
 * three are small, farm-wide and change about once a season, so they are
 * fetched whole and cached for ten minutes rather than refetched per field —
 * the spray check lets you tick fields on and off, and a query per tick would
 * put a round trip behind a checkbox.
 */

const STALE = 10 * 60_000

/** Which resistance groups each product puts in the tank. */
export function useProductMoa() {
  return useQuery({
    queryKey: ['product_moa_v'],
    staleTime: STALE,
    queryFn: async (): Promise<ProductMoa[]> => {
      const { data, error } = await supabase
        .from('product_moa_v')
        .select('product_id, product_name, active, scheme, group_code, group_name, ph_sensitive, time_of_day, group_note')
      if (error) throw error
      return (data ?? []) as ProductMoa[]
    },
  })
}

/** Every application that resolved to a group, for counting repeats per field. */
export function useFieldMoaHistory() {
  return useQuery({
    queryKey: ['field_moa_history_v'],
    staleTime: STALE,
    queryFn: async (): Promise<MoaPass[]> => {
      const { data, error } = await supabase
        .from('field_moa_history_v')
        .select('field_id, crop_season, applied_on, operation_id, product_id, product_name, active, scheme, group_code, group_name')
        .order('applied_on')
      if (error) throw error
      return (data ?? []) as MoaPass[]
    },
  })
}

/**
 * How many passes per field could NOT be placed in a group, so the count can
 * say so. A product with no PMRA registration and no actives entered by hand
 * is invisible to every rule here, and "two seasons of Group 9" read as the
 * whole truth when a third pass was an unplaced product would be worse than
 * no count at all.
 */
export function useFieldMoaUnknown() {
  return useQuery({
    queryKey: ['field_moa_unknown_v'],
    staleTime: STALE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('field_moa_unknown_v')
        .select('field_id, crop_season, passes, products')
      if (error) throw error
      return (data ?? []) as { field_id: string; crop_season: number | null; passes: number; products: number }[]
    },
  })
}

/** Topsoil pH and organic matter per field, from the latest test that measured pH. */
export function useFieldSoilPh() {
  return useQuery({
    queryKey: ['field_soil_ph_v'],
    staleTime: STALE,
    queryFn: async (): Promise<Map<string, FieldSoil>> => {
      const { data, error } = await supabase
        .from('field_soil_ph_v')
        .select('field_id, crop_year, ph, ph_max, om_pct, samples')
      if (error) throw error
      return new Map(((data ?? []) as FieldSoil[]).map((r) => [r.field_id, r]))
    },
  })
}
