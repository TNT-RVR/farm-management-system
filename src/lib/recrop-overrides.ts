import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

/**
 * The supplier's shorter re-cropping interval, by PMRA registration.
 *
 * Zidua is the case it was written for (Sam, 28 Oct 2026): the label's
 * re-crop table holds fields off crops for the best part of a season, the
 * chemical company says six months after spraying is enough for any rotational
 * crop, and the planner was warning about ground nobody was worried about.
 *
 * It is a cap, not a correction. The label's own words stay in
 * chemical_recrop_rules — that table is replaced whenever a label is re-read,
 * so an edit there would be lost — and chemical_recrop_rules_v applies the cap
 * on top, marking the rule `capped`.
 *
 * No audit trigger on this table: fn_audit needs a uuid primary key and this
 * one is keyed by the registration number, so told_by and set_on are the only
 * record of who said so and when. Both are worth filling in.
 */

export type RecropOverride = {
  /** PMRA/PCP registration number of the product, as jd_products carries it. */
  registration_number: string
  max_months: number
  reason: string
  told_by: string | null
  set_on: string
}

/** Our own key; the capped rules are cached under the two below it. */
const KEY = ['chemical_recrop_overrides']

function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: KEY })
    // The cap is baked into chemical_recrop_rules_v, which both of these read,
    // so a change here means nothing on screen until they are refetched.
    void qc.invalidateQueries({ queryKey: ['rotation-context'] })
    void qc.invalidateQueries({ queryKey: ['chemical_recrop_rules'] })
  }
}

export function useRecropOverrides() {
  return useQuery({
    queryKey: KEY,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<RecropOverride[]> => {
      const { data, error } = await supabase
        .from('chemical_recrop_overrides')
        .select('registration_number, max_months, reason, told_by, set_on')
        .order('registration_number')
      if (error) throw error
      // max_months is numeric: Postgres sends "6" for some numerics, and the
      // months are compared as numbers.
      return (data ?? []).map((r) => ({ ...r, max_months: Number(r.max_months) }))
    },
  })
}

/**
 * Add a cap or change one. Keyed by registration, so saving the same product
 * twice replaces the first answer rather than leaving two caps to disagree.
 */
export function useSaveRecropOverride() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (v: {
      registration_number: string
      max_months: number
      reason: string
      told_by?: string | null
    }) => {
      const { error } = await supabase.from('chemical_recrop_overrides').upsert(
        {
          registration_number: v.registration_number,
          max_months: v.max_months,
          reason: v.reason,
          told_by: v.told_by?.trim() || null,
        },
        { onConflict: 'registration_number' },
      )
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/** Drop a cap: the label's own interval applies again from the next refetch. */
export function useDeleteRecropOverride() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (registration_number: string) => {
      const { error } = await supabase
        .from('chemical_recrop_overrides')
        .delete()
        .eq('registration_number', registration_number)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}
