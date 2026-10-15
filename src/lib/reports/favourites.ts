import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * The reports this person has starred (Sam, 9 Oct 2026): their own list,
 * kept in report_favourites so it follows them to any device. Row security
 * means the query only ever sees the signed-in person's rows.
 */
const KEY = ['report_favourites']

export function useReportFavourites() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.from('report_favourites').select('report_id')
      if (error) throw error
      return (data ?? []).map((r) => r.report_id)
    },
  })
}

/** Star or unstar a report; the star changes at once and settles when the save returns. */
export function useToggleFavourite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ reportId, on }: { reportId: string; on: boolean }) => {
      const { error } = on
        ? await supabase.from('report_favourites').insert({ report_id: reportId })
        : await supabase.from('report_favourites').delete().eq('report_id', reportId)
      if (error) throw error
    },
    onMutate: async ({ reportId, on }) => {
      await qc.cancelQueries({ queryKey: KEY })
      const before = qc.getQueryData<string[]>(KEY)
      qc.setQueryData<string[]>(KEY, (cur = []) => (on ? [...new Set([...cur, reportId])] : cur.filter((id) => id !== reportId)))
      return { before }
    },
    onError: (_e, _v, c) => qc.setQueryData(KEY, c?.before),
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  })
}
