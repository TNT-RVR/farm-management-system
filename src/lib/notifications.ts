import { useEffect } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './auth'
import { linkTarget } from './notification-format'
import type { Delivery, PrefRow } from './notification-kinds'
import { DEFAULT_TIMING, type NotificationTiming } from './notification-schedule'
import type { Database } from './database.types'

export type NotificationRow = Database['public']['Tables']['notifications']['Row']

/**
 * My list order: unread first, each part newest first, or plain newest first.
 * Ordered by the database (the `unread` computed field) so paging stays right.
 */
function inMyOrder<Q extends { order: (column: string, o: { ascending: boolean }) => Q }>(q: Q, unreadFirst: boolean): Q {
  return (unreadFirst ? q.order('unread', { ascending: false }) : q).order('created_at', { ascending: false })
}

/** The newest hundred, unread first if I list them that way. `enabled` off holds the fetch: the header bell reads them only while its dropdown is open. */
export function useNotifications(enabled = true) {
  const { session } = useAuth()
  const { data: order } = useNotificationOrder()
  const unreadFirst = order ?? true
  return useQuery({
    queryKey: ['notifications', 'recent', { unreadFirst }],
    enabled: Boolean(session) && enabled && order !== undefined,
    queryFn: async () => {
      const { data, error } = await inMyOrder(supabase.from('notifications').select('*'), unreadFirst).limit(100)
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
    // A private Broadcast topic per person, sent by a trigger on insert: the
    // table change feed made the database read every write the farm makes.
    const channel = supabase
      .channel(`notifications:${session.user.id}`, { config: { private: true } })
      .on('broadcast', { event: 'insert' }, () => {
        // The count, the newest-hundred list and the Notifications page's
        // feed. Only those on screen refetch: the bell's list is held while
        // its dropdown is shut, so a new notification costs one count query.
        void queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY })
        void queryClient.invalidateQueries({ queryKey: ['notifications', 'recent'] })
        void queryClient.invalidateQueries({ queryKey: ['notifications', 'feed'] })
      })
      .subscribe()
    return () => void supabase.removeChannel(channel)
  }, [session, queryClient])
}

const UNREAD_COUNT_KEY = ['notifications', 'unread-count']

/** The unread total for the bell and the app icon: counted, so it stays right past the newest 100. */
export function useUnreadCount() {
  const { session } = useAuth()
  return useQuery({
    queryKey: UNREAD_COUNT_KEY,
    enabled: Boolean(session),
    queryFn: async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null)
      if (error) throw error
      return count ?? 0
    },
  })
}

export const NOTIFICATION_PAGE = 30

export type NotificationFilter = { unread: boolean; kinds: string[] | null }

/** The Notifications page: in my order, a page at a time, optionally unread only or of some kinds. */
export function useNotificationFeed(filter: NotificationFilter) {
  const { session } = useAuth()
  const { data: order } = useNotificationOrder()
  const unreadFirst = order ?? true
  return useInfiniteQuery({
    queryKey: ['notifications', 'feed', { unread: filter.unread, kinds: filter.kinds, unreadFirst }],
    enabled: Boolean(session) && order !== undefined,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let q = supabase.from('notifications').select('*')
      if (filter.unread) q = q.is('read_at', null)
      if (filter.kinds?.length) q = q.in('kind', filter.kinds)
      const { data, error } = await inMyOrder(q, unreadFirst && !filter.unread).range(pageParam, pageParam + NOTIFICATION_PAGE - 1)
      if (error) throw error
      return data
    },
    getNextPageParam: (last, pages) =>
      last.length < NOTIFICATION_PAGE ? undefined : pages.reduce((n, p) => n + p.length, 0),
  })
}

type ReadRow = Pick<NotificationRow, 'id' | 'read_at'>

/** Apply `fn` to every row of a cached notifications query: the plain list or the paged feed. Anything else passes through. */
function mapRows<T>(data: T, fn: (r: ReadRow) => ReadRow): T {
  if (Array.isArray(data)) return (data as ReadRow[]).map(fn) as T
  if (data && typeof data === 'object' && Array.isArray((data as { pages?: unknown }).pages)) {
    const d = data as unknown as { pages: ReadRow[][] }
    return { ...d, pages: d.pages.map((p) => p.map(fn)) } as T
  }
  return data
}

/**
 * A cached notifications query with read state set: on the rows in `ids`, or
 * (`ids` null) on every unread row — "mark all read" leaves rows already read
 * with the time they were read.
 */
export function patchReadState<T>(data: T, ids: Set<string> | null, readAt: string | null): T {
  return mapRows(data, (r) =>
    ids === null ? (r.read_at == null ? { ...r, read_at: readAt } : r) : ids.has(r.id) ? { ...r, read_at: readAt } : r,
  )
}

/** How far the unread count moves when `ids` are marked read (or unread), judged from the rows in the cache. */
export function unreadDelta(cached: unknown[], ids: Set<string>, read: boolean): number {
  const wasUnread = new Map<string, boolean>()
  for (const d of cached)
    mapRows(d, (r) => {
      if (ids.has(r.id)) wasUnread.set(r.id, r.read_at == null)
      return r
    })
  let delta = 0
  for (const u of wasUnread.values()) {
    if (read && u) delta -= 1
    if (!read && !u) delta += 1
  }
  return delta
}

/**
 * Mark notifications read or unread, or every unread one read (`ids: 'all'`).
 * Optimistic: the dot, the circle and the bell's count change at the tap, and
 * roll back if the write fails.
 */
export function useSetRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, read }: { ids: string[] | 'all'; read: boolean }) => {
      const update = supabase.from('notifications').update({ read_at: read ? new Date().toISOString() : null })
      const { error } = ids === 'all' ? await update.is('read_at', null) : await update.in('id', ids)
      if (error) throw error
    },
    onMutate: async ({ ids, read }) => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] })
      const snapshot = queryClient.getQueriesData({ queryKey: ['notifications'] })
      const set = ids === 'all' ? null : new Set(ids)
      const count = queryClient.getQueryData<number>(UNREAD_COUNT_KEY)
      if (count != null) {
        const next = set === null ? 0 : count + unreadDelta(snapshot.map(([, d]) => d), set, read)
        queryClient.setQueryData(UNREAD_COUNT_KEY, Math.max(0, next))
      }
      const readAt = read ? new Date().toISOString() : null
      queryClient.setQueriesData({ queryKey: ['notifications'] }, (d: unknown) => patchReadState(d, set, readAt))
      return { snapshot }
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) queryClient.setQueryData(key, data)
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

/**
 * Open a notification: mark it read, then go where it points — an in-app page,
 * an outside address in a new tab, or (no link) its own page under Notifications.
 */
export function useOpenNotification() {
  const navigate = useNavigate()
  const setRead = useSetRead()
  return (n: Pick<NotificationRow, 'id' | 'link' | 'read_at'>) => {
    if (!n.read_at) setRead.mutate({ ids: [n.id], read: true })
    const target = linkTarget(n.link, window.location.origin)
    if (target?.type === 'external') window.open(target.href, '_blank', 'noopener,noreferrer')
    else navigate(target?.type === 'internal' ? target.to : `/notifications/${n.id}`)
  }
}

/** Versioned: rows gained `push` (15 Oct 2026) and `delivery` (16 Oct 2026), so an older cached shape is not read back. */
const PREFS_KEY = ['notification_prefs', 'v3']

/** My switches: one row per kind I have changed; no row is on. */
export function useNotificationPrefs() {
  const { session } = useAuth()
  return useQuery({
    queryKey: PREFS_KEY,
    enabled: Boolean(session),
    queryFn: async (): Promise<PrefRow[]> => {
      const { data, error } = await supabase.from('notification_prefs').select('kind, in_app, push, delivery')
      if (error) throw error
      return data.map((r) => ({
        kind: r.kind,
        in_app: r.in_app,
        push: r.push ?? true,
        delivery: (r.delivery === 'digest' ? 'digest' : 'now') as Delivery,
      }))
    },
  })
}

/** Save switches (one row per kind), shown at the tap and rolled back if the write fails. */
export function useSetPrefs() {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (rows: PrefRow[]) => {
      const { error } = await supabase
        .from('notification_prefs')
        .upsert(
          rows.map((r) => ({ user_id: session!.user.id, kind: r.kind, in_app: r.in_app, push: r.push, delivery: r.delivery })),
          { onConflict: 'user_id,kind' },
        )
      if (error) throw error
    },
    onMutate: async (rows) => {
      await queryClient.cancelQueries({ queryKey: PREFS_KEY })
      const before = queryClient.getQueryData<PrefRow[]>(PREFS_KEY)
      const changed = new Map(rows.map((r) => [r.kind, r]))
      queryClient.setQueryData<PrefRow[]>(PREFS_KEY, [
        ...(before ?? []).filter((r) => !changed.has(r.kind)),
        ...rows,
      ])
      return { before }
    },
    onError: (_e, _v, ctx) => queryClient.setQueryData(PREFS_KEY, ctx?.before),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: PREFS_KEY }),
  })
}

const TIMING_KEY = ['notification_settings', 'v1']

/** My quiet hours and digest time. No row is quiet hours off, digest at 7. Times read "HH:MM". */
export function useNotificationTiming() {
  const { session } = useAuth()
  return useQuery({
    queryKey: TIMING_KEY,
    enabled: Boolean(session),
    queryFn: async (): Promise<NotificationTiming> => {
      const { data, error } = await supabase
        .from('notification_settings')
        .select('quiet_on, quiet_start, quiet_end, digest_at')
        .maybeSingle()
      if (error) throw error
      if (!data) return DEFAULT_TIMING
      return {
        quiet_on: data.quiet_on,
        quiet_start: data.quiet_start.slice(0, 5),
        quiet_end: data.quiet_end.slice(0, 5),
        digest_at: data.digest_at.slice(0, 5),
      }
    },
  })
}

const ORDER_KEY = ['notification_settings', 'order']

/** true: my bell and Notifications page list unread first. On until I turn it off (no settings row reads as on). */
export function useNotificationOrder() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ORDER_KEY,
    enabled: Boolean(session),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.from('notification_settings').select('unread_first').maybeSingle()
      if (error) throw error
      return data?.unread_first ?? true
    },
  })
}

/** Save my list order; the lists re-read in the new order. */
export function useSetNotificationOrder() {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (unreadFirst: boolean) => {
      const { error } = await supabase
        .from('notification_settings')
        .upsert({ user_id: session!.user.id, unread_first: unreadFirst, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      if (error) throw error
    },
    onMutate: async (unreadFirst) => {
      const before = queryClient.getQueryData<boolean>(ORDER_KEY)
      queryClient.setQueryData(ORDER_KEY, unreadFirst)
      return { before }
    },
    onError: (_e, _v, ctx) => queryClient.setQueryData(ORDER_KEY, ctx?.before),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ORDER_KEY }),
  })
}

/** Save my quiet hours and digest time, shown at the tap and rolled back if the write fails. */
export function useSetNotificationTiming() {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (t: NotificationTiming) => {
      const { error } = await supabase
        .from('notification_settings')
        .upsert({ user_id: session!.user.id, ...t, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      if (error) throw error
    },
    onMutate: async (t) => {
      await queryClient.cancelQueries({ queryKey: TIMING_KEY })
      const before = queryClient.getQueryData<NotificationTiming>(TIMING_KEY)
      queryClient.setQueryData(TIMING_KEY, t)
      return { before }
    },
    onError: (_e, _v, ctx) => queryClient.setQueryData(TIMING_KEY, ctx?.before),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: TIMING_KEY }),
  })
}
