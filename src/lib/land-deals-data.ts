import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { LandDeal } from './land-deals'

/** Every lease as a land deal (cash rent, 50/50 net profit, or crop share), land rented out included. */
export function useLandDeals() {
  return useQuery({
    queryKey: ['land-leases', 'deals'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<LandDeal[]> => {
      const { data, error } = await supabase
        .from('land_leases')
        .select('landlord, arrangement, field_ids, rent_per_acre, rent_total, our_share_pct, crop_share_pct, inputs_shared, active, start_date, end_date, direction, crop_ids')
      if (error) throw error
      return (data ?? []).map((d) => ({
        ...d,
        arrangement: (d.arrangement ?? 'cash_rent') as LandDeal['arrangement'],
        field_ids: d.field_ids ?? [],
        rent_per_acre: d.rent_per_acre == null ? null : Number(d.rent_per_acre),
        rent_total: d.rent_total == null ? null : Number(d.rent_total),
        our_share_pct: d.our_share_pct == null ? null : Number(d.our_share_pct),
        crop_share_pct: d.crop_share_pct == null ? null : Number(d.crop_share_pct),
        inputs_shared: d.inputs_shared ?? true,
        direction: d.direction === 'out' ? 'out' : 'in',
        crop_ids: d.crop_ids ?? null,
      }))
    },
  })
}
