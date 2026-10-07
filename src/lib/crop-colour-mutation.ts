import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

/**
 * Saving a crop's colour.
 *
 * Separate from crop-colour.ts so that module stays pure and testable — it is
 * imported by map code and by the bin drawing, neither of which should drag
 * react-query and a Supabase client in with them.
 *
 * Every screen that draws a crop reads from the ['crops'] query, so one
 * invalidation repaints the lot.
 */
export function useSetCropColour() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, color }: { id: string; color: string }) => {
      const { error } = await supabase.from('crops').update({ color }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['crops'] }),
  })
}
