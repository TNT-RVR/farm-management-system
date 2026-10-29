/**
 * Bin yards (Sam, 22 Oct 2026): the farm's own list of yards, each shown or
 * hidden for the whole farm, in an order, added, renamed and deleted on the
 * Bins page. A bin's `site` is its yard's name. A hidden yard's bins are left
 * out of the bin totals, the estimator and the weigh-in's bin list; the map
 * keeps them, last, so their pins can still be placed.
 *
 * Replaces the hard-coded "creek yard" switch kept on each device, which
 * meant nothing on any other farm.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type BinYard = Database['public']['Tables']['bin_yards']['Row']

const KEY = ['bin_yards'] as const

export function useBinYards() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<BinYard[]> => {
      const { data, error } = await supabase.from('bin_yards').select('*').order('sort').order('name')
      if (error) throw error
      return data ?? []
    },
    staleTime: 10 * 60_000,
  })
}

/** The names of the hidden yards. */
export function hiddenYardNames(yards: BinYard[] | undefined): Set<string> {
  return new Set((yards ?? []).filter((y) => !y.shown).map((y) => y.name))
}

/** A bin is in a hidden yard. A bin with no yard is never hidden. */
export const inHiddenYard = (b: { site: string | null }, hidden: Set<string>) => !!b.site && hidden.has(b.site)

/** The yards in their order: their place in the list. Unknown names last. */
export function yardRank(yards: BinYard[] | undefined): (name: string | null) => number {
  const at = new Map((yards ?? []).map((y, i) => [y.name, i]))
  return (name) => (name != null && at.has(name) ? at.get(name)! : 1e6)
}

function useYardWrite<V>(fn: (v: V) => Promise<void>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
      // A rename carries to the bins (bins.site), so they read again too.
      void qc.invalidateQueries({ queryKey: ['bins'] })
    },
  })
}

export function useAddBinYard() {
  return useYardWrite(async (name: string) => {
    const { data: last } = await supabase.from('bin_yards').select('sort').order('sort', { ascending: false }).limit(1).maybeSingle()
    const { error } = await supabase.from('bin_yards').insert({ name: name.trim(), sort: (last?.sort ?? -1) + 1 })
    if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'There is already a yard with that name.' : error.message)
  })
}

export function useUpdateBinYard() {
  return useYardWrite(async (v: { id: string; name?: string; shown?: boolean; sort?: number }) => {
    const { id, ...patch } = v
    if (patch.name != null) patch.name = patch.name.trim()
    const { error } = await supabase.from('bin_yards').update(patch).eq('id', id)
    if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'There is already a yard with that name.' : error.message)
  })
}

/** Swap a yard with the one above or below it. */
export function useMoveBinYard() {
  return useYardWrite(async (v: { a: BinYard; b: BinYard }) => {
    const r1 = await supabase.from('bin_yards').update({ sort: v.b.sort }).eq('id', v.a.id)
    if (r1.error) throw r1.error
    const r2 = await supabase.from('bin_yards').update({ sort: v.a.sort }).eq('id', v.b.id)
    if (r2.error) throw r2.error
  })
}

/**
 * The home yard: distances to the fields are measured from its bins
 * (field_yard_distance). One at a time, so the old one is cleared first.
 */
export function useSetHomeYard() {
  return useYardWrite(async (id: string) => {
    const off = await supabase.from('bin_yards').update({ home: false }).eq('home', true).neq('id', id)
    if (off.error) throw off.error
    const on = await supabase.from('bin_yards').update({ home: true }).eq('id', id)
    if (on.error) throw on.error
  })
}

export function useDeleteBinYard() {
  return useYardWrite(async (id: string) => {
    const { error } = await supabase.from('bin_yards').delete().eq('id', id)
    if (error) throw new Error(/foreign key|violates/i.test(error.message) ? 'Move its bins to another yard first.' : error.message)
  })
}
