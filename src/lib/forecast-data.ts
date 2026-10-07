/**
 * What forecast.ts reads: every year's prices and input budgets (a year with
 * none carries the latest earlier one), and the harvested yields behind the
 * expected yields.
 *
 * Keyed under the same roots as the single-year queries (['crop_prices'],
 * ['crop_inputs']) so the editors' invalidations refresh these too.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { CropInputRow, CropPriceRow } from './queries'
import type { YieldRecord } from './forecast'

const PAGE = 1000

/** Every row of a select, a page at a time (PostgREST stops at 1,000). */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

export function useAllCropPrices() {
  return useQuery({
    queryKey: ['crop_prices', 'all'],
    queryFn: () => all<CropPriceRow>((a, b) => supabase.from('crop_prices').select('*').order('crop_year').order('id').range(a, b)),
  })
}

export function useAllCropInputs() {
  return useQuery({
    queryKey: ['crop_inputs', 'all'],
    queryFn: () => all<CropInputRow>((a, b) => supabase.from('crop_inputs').select('*').order('crop_year').order('id').range(a, b)),
  })
}

/** Every crop_history row with a yield; forecast.ts decides which are harvests. */
export function useYieldHistory() {
  return useQuery({
    queryKey: ['crop_history', 'yields'],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<YieldRecord[]> => {
      const rows = await all<{
        field_id: string
        crop_id: string | null
        crop_year: number
        acres: number | string | null
        yield_per_acre: number | string | null
        clean_yield_per_acre: number | string | null
        yield_unit: string | null
        source: string | null
      }>((a, b) =>
        supabase
          .from('crop_history')
          .select('field_id, crop_id, crop_year, acres, yield_per_acre, clean_yield_per_acre, yield_unit, source')
          .not('yield_per_acre', 'is', null)
          .order('id')
          .range(a, b),
      )
      const n = (v: number | string | null) => (v == null ? null : Number(v))
      return rows.map((r) => ({ ...r, acres: n(r.acres), yield_per_acre: n(r.yield_per_acre), clean_yield_per_acre: n(r.clean_yield_per_acre) }))
    },
  })
}
