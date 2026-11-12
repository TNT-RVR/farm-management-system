import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { ContactType } from '@/lib/sales'

// contact_candidates is newer than the generated types.
const db = supabase as unknown as SupabaseClient

export type CandidateStatus = 'pending' | 'approved' | 'rejected'

export type CandidateRow = {
  id: string
  company: string
  contact_name: string | null
  role: string | null
  email: string | null
  phone: string | null
  type: ContactType
  why: string
  source: 'mail' | 'quickbooks' | 'both' | 'contacts'
  source_detail: string | null
  status: CandidateStatus
  decided_at: string | null
  contact_id: string | null
  created_at: string
}

export const SOURCE_LABEL: Record<CandidateRow['source'], string> = {
  mail: 'Email',
  quickbooks: 'QuickBooks',
  both: 'Email + QuickBooks',
  contacts: 'Your contacts',
}

export function useContactCandidates() {
  return useQuery({
    queryKey: ['contact_candidates'],
    queryFn: async () => {
      const { data, error } = await db
        .from('contact_candidates')
        .select('*')
        // Pending first, then the most useful rows at the top: a name and a
        // phone beats a company with neither, which is what Sam can act on.
        .order('company')
      if (error) throw error
      return (data ?? []) as CandidateRow[]
    },
  })
}

/**
 * Approve, reject and undo.
 *
 * Approving goes through the database function, not two writes from here: it
 * inserts the contact and links the candidate in one statement, so a dropped
 * connection cannot leave a contact nobody asked for.
 */
export function useCandidateDecisions() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['contact_candidates'] })
    void queryClient.invalidateQueries({ queryKey: ['contacts'] })
  }

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await db.rpc('approve_contact_candidate', { p_id: id })
      if (error) throw error
      return data as string
    },
    onSuccess: invalidate,
  })

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'pending' | 'rejected' }) => {
      const { error } = await db.rpc('set_contact_candidate_status', { p_id: id, p_status: status })
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  /**
   * Rewrite a candidate's "why it matters".
   *
   * Sam, 4 Nov 2026: "a lot of them are wrong". They are my sentences, drawn
   * from the mail and the books, and the ones drawn from a supplier's name
   * alone were guesses. He knows what each business actually does, so the
   * sentence has to be his to change before he decides on the row -- and the
   * text he lands on is what approving copies into the contact's notes.
   */
  const editWhy = useMutation({
    mutationFn: async ({ id, why }: { id: string; why: string }) => {
      const { error } = await db.from('contact_candidates').update({ why }).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  return { approve, setStatus, editWhy }
}
