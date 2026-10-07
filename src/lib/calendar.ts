import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type CalendarEventRow = Database['public']['Tables']['calendar_events']['Row']
export type EventKind = CalendarEventRow['kind']
export type MonthlyTemplateRow = Database['public']['Tables']['monthly_task_templates']['Row']
export type MonthlyInstanceRow = Database['public']['Tables']['monthly_task_instances']['Row']

export const EVENT_KINDS: EventKind[] = [
  'general',
  'field_work',
  'meeting',
  'maintenance',
  'delivery',
  'other',
]

export const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export function useCalendarEvents() {
  return useQuery({
    queryKey: ['calendar_events'],
    queryFn: async () => {
      const { data, error } = await supabase.from('calendar_events').select('*')
      if (error) throw error
      return data
    },
  })
}

export function useEventMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['calendar_events'] })
  const create = useMutation({
    mutationFn: async (event: Database['public']['Tables']['calendar_events']['Insert']) => {
      const { data: auth } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('calendar_events')
        .insert({ ...event, created_by: auth.user!.id })
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
      patch: Database['public']['Tables']['calendar_events']['Update']
    }) => {
      const { error } = await supabase.from('calendar_events').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('calendar_events').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { create, update, remove }
}

export function useMonthlyTemplates() {
  return useQuery({
    queryKey: ['monthly_templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('monthly_task_templates')
        .select('*')
        .order('sort_order')
        .order('title')
      if (error) throw error
      return data
    },
  })
}

/** Ensures the year's instances exist (current/future) and returns them. */
export function useMonthlyInstances(cropYear: number) {
  return useQuery({
    queryKey: ['monthly_instances', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ensure_monthly_instances', { p_year: cropYear })
      if (error) throw error
      return data as MonthlyInstanceRow[]
    },
  })
}

export function useToggleMonthlyInstance(cropYear: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const { error } = await supabase
        .from('monthly_task_instances')
        .update({ completed })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['monthly_instances', cropYear] }),
  })
}

export function useMonthlyTemplateMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['monthly_templates'] })
    void queryClient.invalidateQueries({ queryKey: ['monthly_instances'] })
  }
  const create = useMutation({
    mutationFn: async (tpl: Database['public']['Tables']['monthly_task_templates']['Insert']) => {
      const { error } = await supabase.from('monthly_task_templates').insert(tpl)
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
      patch: Database['public']['Tables']['monthly_task_templates']['Update']
    }) => {
      const { error } = await supabase.from('monthly_task_templates').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('monthly_task_templates').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { create, update, remove }
}

/**
 * One-click subscribe link for Google Calendar.
 *
 * The cid parameter must keep the webcal:// scheme — Google rejects https://
 * there — while the feed itself is served over HTTPS by the same host.
 */
export function googleSubscribeUrl(feedUrl: string): string {
  // Swap only the scheme; the // and the rest of the URL are untouched, which
  // avoids escaping slashes in a regex.
  const webcal = feedUrl.replace(/^https?:/, 'webcal:')
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`
}

/** The personal iCal feed URL for a token. */
export function feedUrlFor(token: string): string {
  return `${window.location.origin}/api/calendar-feed?token=${token}`
}

/**
 * Issue a new feed token, which immediately invalidates the old link. The URL is
 * a bearer credential — anyone holding it can read the calendar — so there has
 * to be a way to revoke one that has been forwarded or leaked.
 */
export function useRegenerateFeedToken() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser()
      const token = crypto.randomUUID()
      const { error } = await supabase
        .from('users')
        .update({ calendar_feed_token: token })
        .eq('id', auth.user!.id)
      if (error) throw error
      return token
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['feed_token'] }),
  })
}

export function useFeedToken() {
  return useQuery({
    queryKey: ['feed_token'],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('users')
        .select('calendar_feed_token')
        .eq('id', auth.user!.id)
        .single()
      if (error) throw error
      return data.calendar_feed_token as string
    },
  })
}
