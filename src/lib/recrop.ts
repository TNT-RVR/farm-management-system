import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { RecropRule } from './rotation-engine'

/**
 * Every label's re-cropping rules by PMRA registration, and which labels have
 * been read (a label with nothing on it is read too — "none" is an answer,
 * "not read yet" is not).
 */
export function useRecropRules(enabled = true) {
  return useQuery({
    queryKey: ['chemical_recrop_rules'],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const [rules, labels] = await Promise.all([
        supabase.from('chemical_recrop_rules').select('registration_number, crop_key, following_crop, months, status, condition, quote'),
        supabase.from('chemical_labels').select('registration_number, recrop_status'),
      ])
      if (rules.error) throw rules.error
      if (labels.error) throw labels.error
      const byReg = new Map<string, RecropRule[]>()
      for (const r of (rules.data ?? []) as RecropRule[]) byReg.set(r.registration_number, [...(byReg.get(r.registration_number) ?? []), r])
      const read = new Set((labels.data ?? []).filter((l) => l.recrop_status === 'read' || l.recrop_status === 'none_on_label').map((l) => l.registration_number))
      return { byReg, read }
    },
  })
}
