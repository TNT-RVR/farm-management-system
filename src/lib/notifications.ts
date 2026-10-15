import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAuth } from './auth'
import type { Database } from './database.types'

export type NotificationRow = Database['public']['Tables']['notifications']['Row']
export type NotificationPrefRow = Database['public']['Tables']['notification_prefs']['Row']

export const NOTIFICATION_KINDS: { kind: string; label: string }[] = [
  { kind: 'task_assigned', label: 'Task assigned to me' },
  { kind: 'task_completed', label: 'My task completed by someone' },
  { kind: 'task_reminder', label: 'Task reminders' },
  { kind: 'bin_needs_air', label: 'A bin went up tough and needs air' },
  { kind: 'fert_buy_window', label: 'A fertilizer falls into its cheapest third' },
  { kind: 'fert_deadline', label: 'An early-order deadline is a week away' },
]

export function useNotifications() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['notifications'],
    enabled: Boolean(session),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data
    },
  })
}

/** Live badge: refetch notifications whenever a new one arrives for me. */
export function useNotificationsRealtime() {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!session) return
    const channel = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${session.user.id}`,
        },
        () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      )
      .subscribe()
    return () => void supabase.removeChannel(channel)
  }, [session, queryClient])
}

export function useMarkRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .in('id', ids)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export function useNotificationPrefs() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['notification_prefs'],
    enabled: Boolean(session),
    queryFn: async () => {
      const { data, error } = await supabase.from('notification_prefs').select('*')
      if (error) throw error
      return data
    },
  })
}

export function useSetPref() {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ kind, in_app }: { kind: string; in_app: boolean }) => {
      const { error } = await supabase
        .from('notification_prefs')
        .upsert(
          { user_id: session!.user.id, kind, in_app },
          { onConflict: 'user_id,kind' },
        )
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notification_prefs'] }),
  })
}
