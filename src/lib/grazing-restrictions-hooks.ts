import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { loadGrazingData } from './grazing-data'
import { grazingPicture, type GrazingRule } from './grazing-restrictions'
import { albertaDay } from './spray-products'

/** Today in Alberta, as the restrictions count days. */
export const grazingToday = () => albertaDay(new Date().toISOString())

/** The farm's sprays, labels' grazing rules, pastures and grazing, as one read. */
export function grazingDataQuery() {
  return {
    // Versioned: persisted offline, and an older shape would crash the screens.
    queryKey: ['grazing-restrictions', 'v1'],
    staleTime: 10 * 60_000,
    queryFn: () => loadGrazingData(supabase, grazingToday()),
  }
}

/** Every field and pasture with its grazing restrictions, the clashes, and what is not known. */
export function useGrazingPicture() {
  const q = useQuery(grazingDataQuery())
  const today = grazingToday()
  const picture = useMemo(() => (q.data ? grazingPicture(q.data, today) : null), [q.data, today])
  return { ...q, picture, today }
}

/** One label's grazing and feeding rules, as the app read them. */
export function useLabelGrazingRules(registration: string | null | undefined) {
  return useQuery({
    queryKey: ['grazing-restrictions', 'rules', registration],
    enabled: Boolean(registration),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chemical_grazing_rules')
        .select('registration_number, crop, crop_key, kind, days, never, condition, quote')
        .eq('registration_number', registration!)
      if (error) throw error
      return (data ?? []) as GrazingRule[]
    },
  })
}

export function usePastureSprayMutations() {
  const qc = useQueryClient()
  const inv = () => void qc.invalidateQueries({ queryKey: ['grazing-restrictions'] })
  return {
    add: useMutation({
      networkMode: 'always',
      mutationFn: async (v: { pasture_id: string; applied_on: string; product: string; registration_number: string | null; notes: string | null }) => {
        const { error } = await supabase.from('pasture_sprays').insert(v)
        if (error) throw error
      },
      onSuccess: inv,
    }),
    // Managers only, by the table's update policy (Sam, 7 Oct 2026: rows get edit).
    update: useMutation({
      networkMode: 'always',
      mutationFn: async ({ id, patch }: { id: string; patch: { pasture_id: string; applied_on: string; product: string; registration_number: string | null; notes: string | null } }) => {
        const { error } = await supabase.from('pasture_sprays').update(patch).eq('id', id)
        if (error) throw error
      },
      onSuccess: inv,
    }),
    remove: useMutation({
      networkMode: 'always',
      mutationFn: async (id: string) => {
        const { error } = await supabase.from('pasture_sprays').delete().eq('id', id)
        if (error) throw error
      },
      onSuccess: inv,
    }),
  }
}

/** The pasture sprays on record, newest first, for the list under the form. */
export function usePastureSprays() {
  return useQuery({
    queryKey: ['grazing-restrictions', 'pasture-sprays'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pasture_sprays')
        .select('id, pasture_id, applied_on, product, registration_number, notes, pastures(name)')
        .order('applied_on', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []) as unknown as { id: string; pasture_id: string; applied_on: string; product: string; registration_number: string | null; notes: string | null; pastures: { name: string } | null }[]
    },
  })
}
