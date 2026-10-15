import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

/**
 * Fields deleted here that John Deere still has.
 *
 * Deleting one used to achieve nothing: the sync matches on the Deere id, found
 * no local field with it, and made the field again — which is why a row of
 * dashes kept reappearing on the field list however many times it was deleted.
 * A delete now leaves a headstone (a trigger on fields), and the sync reads it.
 *
 * Which means a delete is final in a new way, so it has to be visible and
 * undoable: this is the list, and letting one back simply removes its headstone
 * so the next sync brings the field in again.
 */
export type DismissedJdField = {
  jd_field_id: string
  name: string | null
  dismissed_at: string
}

export function dismissedJdFieldsQuery() {
  return {
    queryKey: ['jd_dismissed_fields'],
    queryFn: async (): Promise<DismissedJdField[]> => {
      const { data, error } = await supabase
        .from('jd_dismissed_fields')
        .select('jd_field_id, name, dismissed_at')
        .order('dismissed_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as DismissedJdField[]
    },
  }
}

export function useDismissedJdFields() {
  return useQuery(dismissedJdFieldsQuery())
}

/** Let a dismissed field come back on the next John Deere sync. */
export function useAllowJdField() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (jdFieldId: string) => {
      const { error } = await supabase
        .from('jd_dismissed_fields')
        .delete()
        .eq('jd_field_id', jdFieldId)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jd_dismissed_fields'] }),
  })
}
