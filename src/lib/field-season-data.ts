import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { SeasonWater } from '@/lib/field-season'

/**
 * The one read the field's season summary makes of its own.
 *
 * Everything else it shows is already on the page — the plan, the history and
 * the harvest estimate are all loaded for the cards below it. Water is not,
 * and the farm-wide reads that carry it (the wrap-up report, the Water use
 * report) pull every field's year to do it. This asks for one field's.
 */
export function useFieldSeasonWater(fieldId: string | undefined, year: number) {
  return useQuery({
    queryKey: ['field-season-water', 'v1', fieldId, year],
    enabled: Boolean(fieldId),
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<SeasonWater> => {
      const [events, balance] = await Promise.all([
        supabase
          .from('irrigation_events')
          .select('date, gross_mm, net_mm')
          .eq('field_id', fieldId!)
          .gte('date', `${year}-01-01`)
          .lte('date', `${year}-12-31`),
        // A view an older database may not have: no rain line rather than no card.
        supabase
          .from('field_season_water')
          .select('rain_mm, stress_days')
          .eq('field_id', fieldId!)
          .eq('year', year)
          .maybeSingle(),
      ])
      if (events.error) throw events.error
      return {
        events: (events.data ?? []) as SeasonWater['events'],
        balance: (balance.data ?? null) as SeasonWater['balance'],
      }
    },
  })
}
