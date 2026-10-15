import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type ContactRow = Database['public']['Tables']['contacts']['Row']
export type ContactType = ContactRow['type']
export type ContractRow = Database['public']['Tables']['contracts']['Row']
export type ContractStatus = ContractRow['status']

export const CONTACT_TYPES: ContactType[] = [
  'buyer',
  'supplier',
  'agronomist',
  'custom_operator',
  'trucking',
  'other',
]
export const CONTRACT_STATUSES: ContractStatus[] = ['open', 'partial', 'delivered', 'cancelled']

export function contactsQuery() {
  return {
    queryKey: ['contacts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .order('company', { nullsFirst: false })
        .order('contact_name')
      if (error) throw error
      return data
    },
  }
}

export function useContacts() {
  return useQuery(contactsQuery())
}

export function useContactMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['contacts'] })
  const create = useMutation({
    mutationFn: async (c: Database['public']['Tables']['contacts']['Insert']) => {
      const { data, error } = await supabase.from('contacts').insert(c).select('id').single()
      if (error) throw error
      return data.id
    },
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Database['public']['Tables']['contacts']['Update']
    }) => {
      const { error } = await supabase.from('contacts').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('contacts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { create, update, remove }
}

export function useContracts(cropYear: number) {
  return useQuery({
    queryKey: ['contracts', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contracts')
        .select('*')
        .eq('crop_year', cropYear)
        .order('delivery_start', { nullsFirst: false })
      if (error) throw error
      return data
    },
  })
}

export function useContractMutations(cropYear: number) {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['contracts', cropYear] })
  }
  const create = useMutation({
    mutationFn: async (c: Database['public']['Tables']['contracts']['Insert']) => {
      const { error } = await supabase.from('contracts').insert(c)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Database['public']['Tables']['contracts']['Update']
    }) => {
      const { error } = await supabase.from('contracts').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('contracts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { create, update, remove }
}
