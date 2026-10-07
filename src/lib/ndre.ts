import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { NDVI_RAMP, NO_DATA_COLOUR } from './pastures'

/**
 * NDRE for crop fields: the index that keeps working after NDVI stops.
 *
 * NDVI compares near infrared against red, and a closed canopy absorbs
 * essentially all the red there is. Once corn covers the ground the index runs
 * out of range and every acre reads about the same — right through the weeks
 * that decide the yield. NDRE swaps red for the red edge, which the canopy does
 * not saturate, and keeps separating dense growth into August.
 *
 * It is not a better index, only a better one late. Early, on partial cover,
 * NDVI is the sharper of the two and is what the whole history is built on.
 */

export type FieldNdre = {
  field_id: string
  ndre: number | null
  sensed_on: string | null
  days_since: number | null
}

export function useFieldNdre() {
  return useQuery({
    queryKey: ['field_ndre'],
    queryFn: async (): Promise<FieldNdre[]> => {
      const { data, error } = await supabase.from('field_ndre').select('*')
      if (error) throw error
      return (data ?? []).map((r) => {
        const row = r as unknown as Record<string, unknown>
        const n = Number(row.ndre_mean)
        return {
          field_id: String(row.field_id),
          ndre: Number.isFinite(n) ? n : null,
          sensed_on: (row.sensed_on as string) ?? null,
          days_since: row.days_since == null ? null : Number(row.days_since),
        }
      })
    },
  })
}

/**
 * NDRE onto the same colours as NDVI, over its own range.
 *
 * The ramp is shared so the map means the same thing whichever index is on —
 * brown is poor, dark green is heavy — but the numbers are NOT interchangeable.
 * NDRE on this farm runs about 0.10 to 0.68 where NDVI runs 0.2 to 0.9, so
 * feeding NDRE through the NDVI thresholds would paint a healthy crop brown.
 *
 * Mapped by proportion through the same ramp rather than by a second set of
 * hand-picked cut-offs: the ramp's shape is the design, and duplicating it
 * invites the two to drift apart.
 */
const NDRE_LOW = 0.1
const NDRE_HIGH = 0.6

export function ndreColour(ndre: number | null): string {
  if (ndre == null) return NO_DATA_COLOUR
  const t = Math.max(0, Math.min(1, (ndre - NDRE_LOW) / (NDRE_HIGH - NDRE_LOW)))
  const i = Math.min(NDVI_RAMP.length - 1, Math.round(t * (NDVI_RAMP.length - 1)))
  return NDVI_RAMP[i][1]
}
