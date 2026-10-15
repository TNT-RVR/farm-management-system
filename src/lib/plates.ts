import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

/** The seed plates hanging in the shop, by name and hole count. */
export type PlateRow = {
  id: string
  name: string
  holes: number
  notes: string | null
  active: boolean
}

export function platesQuery() {
  return {
    queryKey: ['planter_plates'],
    queryFn: async () => {
      // Retired plates come back too, and are filtered for the picker by the
      // screen. They have to be readable somewhere: the name is unique across
      // all of them, so a retired plate silently blocks its own name from ever
      // being used again — which reads, correctly, as "I cannot add a plate".
      const { data, error } = await supabase.from('planter_plates').select('*').order('name')
      if (error) throw error
      return (data ?? []) as PlateRow[]
    },
  }
}

export function usePlates() {
  return useQuery(platesQuery())
}

export function usePlateMutations() {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['planter_plates'] })

  const add = useMutation({
    mutationFn: async (p: { name: string; holes: number; notes?: string | null }) => {
      const name = p.name.trim()
      const { error } = await supabase.from('planter_plates').insert({
        name,
        holes: p.holes,
        notes: p.notes?.trim() || null,
      })
      if (!error) return

      if ((error as { code?: string }).code !== '23505') throw error

      // The name is taken. If it is taken by a RETIRED plate, that is not a
      // mistake to report — it is the same disc going back on the planter, and
      // refusing it left somebody unable to add a plate whose clash they could
      // not see. Bring it back with the hole count they just typed.
      const { data: hidden } = await supabase
        .from('planter_plates')
        .select('id, active')
        .eq('name', name)
        .maybeSingle()

      if (hidden && hidden.active === false) {
        const { error: revive } = await supabase
          .from('planter_plates')
          .update({ active: true, holes: p.holes, notes: p.notes?.trim() || null })
          .eq('id', hidden.id)
        if (revive) throw revive
        return
      }
      throw new Error(`There is already a plate called "${name}".`)
    },
    onSuccess: invalidate,
  })

  // Retired rather than deleted: a plate that has been used is part of what a
  // past calibration meant, and deleting it would quietly rewrite that.
  const retire = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('planter_plates').update({ active: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  /**
   * Correct a plate.
   *
   * The hole count especially: a plate entered wrong does not look wrong, it
   * just makes every calibration off that plate quietly incorrect. Being able
   * to fix it in place matters more than it sounds.
   */
  const update = useMutation({
    mutationFn: async (v: { id: string; name: string; holes: number; notes?: string | null }) => {
      const name = v.name.trim()
      const { error } = await supabase
        .from('planter_plates')
        .update({ name, holes: v.holes, notes: v.notes?.trim() || null })
        .eq('id', v.id)
      if (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new Error(`There is already a plate called "${name}".`)
        }
        throw error
      }
    },
    onSuccess: invalidate,
  })

  /** Put a retired plate back on the list, unchanged. */
  const unretire = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('planter_plates').update({ active: true }).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  return { add, update, retire, unretire }
}
