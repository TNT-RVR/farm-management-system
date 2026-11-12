import type { SupabaseClient } from '@supabase/supabase-js'
import type { PastureFieldRow } from './field-residue'

/**
 * The crop fields inside each Grazing-tab pasture, from the farming side
 * (the pasture_field_crops view), for the crop years either side of `year`.
 * Takes whichever client the caller has, so the screens and the server's
 * move-out check read the same rows.
 */
export async function loadPastureFields(sb: SupabaseClient, year: number, ranchId?: string | null): Promise<PastureFieldRow[]> {
  let q = sb
    .from('pasture_field_crops')
    .select(
      'grazing_pasture_id, ranch_id, pasture_id, field_id, field_name, open_to_pasture, grazed_after_harvest, acres_in, field_acres, crop_year, crop_id, crop_name, crop_share, yield_per_acre, yield_source, yield_unit, harvest_on, harvest_source, last_harvest_on, tilled_on, tilled_how, stubble_grazing_id, stubble_grazing_name',
    )
    .gte('crop_year', year - 1)
    .lte('crop_year', year + 1)
  if (ranchId) q = q.eq('ranch_id', ranchId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as PastureFieldRow[]
}
