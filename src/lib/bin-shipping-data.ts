import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { refreshMovements } from './inventory'
import type { Database } from './database.types'

type MovementInsert = Database['public']['Tables']['grain_movements']['Insert']

/**
 * Write a shipment out of a bin. When it takes everything in the bin, the bin
 * is done with too: its plan for the year is removed, a seed report's bin is
 * marked shipped on that day (so the temperature reminders stop) and a
 * contents record kept by hand is closed.
 */
export function useShipOut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { rows: MovementInsert[]; binId: string; cropYear: number; on: string; allOfIt: boolean; contentId: string | null }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase.from('grain_movements').insert(v.rows.map((r) => ({ ...r, created_by: user?.id ?? null })))
      if (error) throw error
      if (!v.allOfIt) return
      // Nothing is planned into the bin any more (Sam, 26 Oct 2026): its
      // plan for the year goes, so it reads as empty and free again.
      const { error: e0 } = await supabase.from('bin_allocations').delete().eq('crop_year', v.cropYear).eq('bin_id', v.binId)
      if (e0) throw e0
      // The seed company's form says when each bin was shipped.
      const { data: reports, error: e1 } = await supabase.from('seed_reports').select('id').eq('crop_year', v.cropYear)
      if (e1) throw e1
      const ids = (reports ?? []).map((r) => r.id)
      if (ids.length) {
        const { error: e2 } = await supabase
          .from('seed_report_bins')
          .update({ shipped_on: v.on, updated_at: new Date().toISOString() })
          .eq('bin_id', v.binId)
          .in('report_id', ids)
          .is('shipped_on', null)
        if (e2) throw e2
      }
      if (v.contentId) {
        const { error: e3 } = await supabase
          .from('bin_contents')
          .update({ emptied_on: v.on, updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
          .eq('id', v.contentId)
        if (e3) throw e3
      }
    },
    onSuccess: () => {
      refreshMovements(qc)
      void qc.invalidateQueries({ queryKey: ['bin_contents_current'] })
      void qc.invalidateQueries({ queryKey: ['bin_allocations'] })
      void qc.invalidateQueries({ queryKey: ['seed_forms'] })
    },
  })
}
