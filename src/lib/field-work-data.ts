import { useEffect, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { get, set } from 'idb-keyval'
import { supabase } from './supabase'
import type { Database, Json } from './database.types'
import { shrinkPhoto } from './scouting'
import { weatherForField } from './work-record-weather'
import { weatherDue, weatherSpan, type FieldWorkRecord, type FieldWorkType } from './field-work'

/**
 * Reading and writing hand-entered field work.
 *
 * Saving with no signal. The app refuses offline writes as a rule (offline.ts,
 * main.tsx), because a queued EDIT can land hours later on a record that has
 * moved. A new work record has none of that risk: it is a new row, its id is
 * made on the phone so sending it twice lands once, and entered_at keeps when
 * it was typed. So a new record saved out of signal is kept on this phone
 * (IndexedDB) and sent when the signal comes back, shown as "waiting for
 * signal" until it is. Edits and deletes still need signal, like everywhere
 * else in the app.
 */

type Insert = Database['public']['Tables']['field_work_records']['Insert']
type Update = Database['public']['Tables']['field_work_records']['Update']

const BUCKET = 'field-work-photos'
const OUTBOX_KEY = 'rvr-field-work-outbox'

// Versioned: these are saved for offline, so a change of shape must not
// restore an old copy.
export const fieldWorkQuery = (fieldId: string) => ({
  queryKey: ['field_work_records', 'v1', 'field', fieldId] as const,
  queryFn: async (): Promise<FieldWorkRecord[]> => {
    const { data, error } = await supabase
      .from('field_work_records')
      .select('*')
      .eq('field_id', fieldId)
      .order('finished_at', { ascending: false, nullsFirst: false })
    if (error) throw error
    return data ?? []
  },
})

export function useFieldWork(fieldId: string | null | undefined) {
  return useQuery({ ...fieldWorkQuery(fieldId ?? ''), enabled: Boolean(fieldId) })
}

export const fieldWorkTypesQuery = () => ({
  queryKey: ['field_work_types', 'v1'] as const,
  queryFn: async (): Promise<FieldWorkType[]> => {
    const { data, error } = await supabase.from('field_work_types').select('*').order('label')
    if (error) throw error
    return data ?? []
  },
})

export function useFieldWorkTypes() {
  return useQuery(fieldWorkTypesQuery())
}

const invalidate = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: ['field_work_records'] })
  // The day book and field progress read these records too.
  void qc.invalidateQueries({ queryKey: ['daybook'] })
  void qc.invalidateQueries({ queryKey: ['field_season_progress'] })
  void qc.invalidateQueries({ queryKey: ['harvest-estimates'] })
  // A baling record puts bales up in the feed supply (a trigger keeps them in step).
  void qc.invalidateQueries({ queryKey: ['feed_inventory'] })
  void qc.invalidateQueries({ queryKey: ['feed_on_hand'] })
  void qc.invalidateQueries({ queryKey: ['feed_lot_fed_from'] })
}

/** A failed fetch, as opposed to the database saying no. */
const isNetworkError = (e: unknown) =>
  e instanceof TypeError || /failed to fetch|network|load failed|fetch failed/i.test(String((e as Error)?.message ?? e))

async function uploadPhotos(row: Insert, photos: Blob[], batch?: string): Promise<string[]> {
  const paths: string[] = []
  for (let i = 0; i < photos.length; i++) {
    // A new record's photos are named from the record alone, so a second send
    // of a queued save overwrites rather than duplicates. Photos added on an
    // edit carry a batch tag so they do not overwrite the first ones.
    const path = `${row.crop_year}/${row.id}${batch ? `-${batch}` : ''}-${i}.jpg`
    const { error } = await supabase.storage.from(BUCKET).upload(path, photos[i], { contentType: 'image/jpeg', upsert: true })
    if (error) throw new Error(`Photo would not upload: ${error.message}`)
    paths.push(path)
  }
  return paths
}

/** The weather columns for a record, or nothing when it cannot be had yet. */
async function weatherColumns(row: Pick<FieldWorkRecord, 'field_id' | 'started_at' | 'finished_at' | 'hours'>): Promise<Update> {
  const span = weatherSpan(row)
  if (!span || Date.parse(span.to) > Date.now()) return { weather: null, weather_at: null, weather_source: null, weather_tried_at: null }
  try {
    const w = await weatherForField(row.field_id, span)
    if (w) return { weather: w.weather as unknown as Json, weather_at: span.to, weather_source: w.source, weather_tried_at: null }
  } catch {
    // Saved without; filled in on a later open.
  }
  return { weather: null, weather_at: null, weather_source: null, weather_tried_at: new Date().toISOString() }
}

/** Send one new record: photos, then the weather, then the row. */
async function sendNew(row: Insert, photos: Blob[]): Promise<void> {
  const added = photos.length ? await uploadPhotos(row, photos) : []
  const wx = await weatherColumns(row as FieldWorkRecord)
  const { error } = await supabase
    .from('field_work_records')
    .upsert({ ...row, ...wx, photo_paths: [...(row.photo_paths ?? []), ...added] }, { onConflict: 'id', ignoreDuplicates: true })
  if (error) {
    if (added.length) await supabase.storage.from(BUCKET).remove(added)
    throw error
  }
}

// ------------------------------------------------------------------ outbox

export type OutboxItem = { row: Insert; photos: Blob[]; queuedAt: string; lastError?: string }

let outbox: OutboxItem[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

async function readOutbox(): Promise<OutboxItem[]> {
  try {
    return (await get<OutboxItem[]>(OUTBOX_KEY)) ?? []
  } catch {
    return []
  }
}
async function writeOutbox(items: OutboxItem[]): Promise<void> {
  outbox = items
  emit()
  await set(OUTBOX_KEY, items)
}

async function enqueue(row: Insert, photos: Blob[]): Promise<void> {
  const items = (await readOutbox()).filter((i) => i.row.id !== row.id)
  await writeOutbox([...items, { row, photos, queuedAt: new Date().toISOString() }])
}

let flushing: Promise<number> | null = null

/**
 * Send every queued record that belongs to whoever is signed in. Stops at the
 * first failed connection; a record the database refuses stays queued with
 * the reason, rather than being dropped.
 */
export function flushFieldWorkOutbox(qc?: QueryClient): Promise<number> {
  if (flushing) return flushing
  flushing = (async () => {
    let sent = 0
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return 0
      const items = await readOutbox()
      if (!items.length) return 0
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const me = session?.user.id
      if (!me) return 0
      const left: OutboxItem[] = []
      let stop = false
      for (const item of items) {
        if (stop || item.row.created_by !== me) {
          left.push(item)
          continue
        }
        try {
          await sendNew(item.row, item.photos)
          sent++
        } catch (e) {
          if (isNetworkError(e)) stop = true
          left.push(isNetworkError(e) ? item : { ...item, lastError: (e as Error).message })
        }
      }
      await writeOutbox(left)
      if (sent && qc) invalidate(qc)
      return sent
    } finally {
      flushing = null
    }
  })()
  return flushing
}

/** Load the queue and send it whenever the connection comes back. Called once, from main.tsx. */
export function installFieldWorkOutbox(qc: QueryClient): void {
  if (typeof window === 'undefined') return
  void readOutbox().then((items) => {
    outbox = items
    emit()
    if (items.length) void flushFieldWorkOutbox(qc)
  })
  window.addEventListener('online', () => void flushFieldWorkOutbox(qc))
  // "Online" with no bars never fires the event; try again every few minutes while anything waits.
  setInterval(() => {
    if (outbox.some((i) => !i.lastError)) void flushFieldWorkOutbox(qc)
  }, 3 * 60_000)
  // A sign-in after a queued save: the session arrives after the page loads.
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' && outbox.length) void flushFieldWorkOutbox(qc)
  })
}

/** Records on this phone still waiting for signal, for one field. */
export function useFieldWorkOutbox(fieldId: string | null | undefined): OutboxItem[] {
  const all = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => outbox,
  )
  return fieldId ? all.filter((i) => i.row.field_id === fieldId) : all
}

export async function discardQueued(id: string): Promise<void> {
  await writeOutbox((await readOutbox()).filter((i) => i.row.id !== id))
}

// ------------------------------------------------------------------ writes

export type SaveInput = {
  row: Insert & { id: string }
  /** New photos to add. */
  photos: File[]
  /** Photos taken off an existing record. */
  removePaths?: string[]
  /** The record as it was, for an edit. */
  before?: FieldWorkRecord
}

const timesChanged = (a: Pick<FieldWorkRecord, 'started_at' | 'finished_at' | 'hours'>, b: Pick<Insert, 'started_at' | 'finished_at' | 'hours'>) =>
  (a.started_at ?? null) !== (b.started_at ?? null) ||
  (a.finished_at ?? null) !== (b.finished_at ?? null) ||
  Number(a.hours ?? 0) !== Number(b.hours ?? 0)

export function useSaveFieldWork() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ row, photos, removePaths = [], before }: SaveInput): Promise<{ queued: boolean }> => {
      if (!before) {
        const blobs = await Promise.all(photos.map((f) => shrinkPhoto(f)))
        if (!navigator.onLine) {
          await enqueue(row, blobs)
          return { queued: true }
        }
        try {
          await sendNew(row, blobs)
          return { queued: false }
        } catch (e) {
          if (!isNetworkError(e)) throw e
          await enqueue(row, blobs)
          return { queued: true }
        }
      }
      if (!navigator.onLine) throw new Error('No connection. A change to a saved record needs signal; new records are kept on the phone until you are back on.')
      const blobs = await Promise.all(photos.map((f) => shrinkPhoto(f)))
      const added = blobs.length ? await uploadPhotos(row, blobs, Date.now().toString(36)) : []
      // The weather is a snapshot: taken again only when the time it describes moved.
      const wx = timesChanged(before, row) ? await weatherColumns(row as FieldWorkRecord) : {}
      const keep = (before.photo_paths ?? []).filter((p) => !removePaths.includes(p))
      // Who entered it and when stay as they were.
      const patch: Update = { ...row }
      delete patch.id
      delete patch.created_by
      delete patch.entered_at
      delete patch.created_at
      const { error } = await supabase
        .from('field_work_records')
        .update({ ...patch, ...wx, photo_paths: [...keep, ...added] })
        .eq('id', row.id)
      if (error) {
        if (added.length) await supabase.storage.from(BUCKET).remove(added)
        throw error
      }
      if (removePaths.length) await supabase.storage.from(BUCKET).remove(removePaths)
      return { queued: false }
    },
    onSuccess: () => invalidate(qc),
  })
}

/** What became of a deleted record's bales in the feed supply. */
export type FeedOnDelete = Database['public']['Functions']['delete_field_work_record']['Returns']

/**
 * Delete a record. Through a database function because a baling record's
 * bales may go from the feed supply with it, which the crew cannot write
 * themselves; bales already fed from are kept and only unlinked.
 */
export function useDeleteFieldWork() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ rec, removeFeed = true }: { rec: FieldWorkRecord; removeFeed?: boolean }): Promise<FeedOnDelete> => {
      const { data, error } = await supabase.rpc('delete_field_work_record', { p_id: rec.id, p_remove_feed: removeFeed })
      if (error) throw error
      if (rec.photo_paths.length) await supabase.storage.from(BUCKET).remove(rec.photo_paths)
      return (data ?? 'none') as FeedOnDelete
    },
    onSuccess: () => invalidate(qc),
  })
}

/** Where a field sits, for the nearest ranch's feed supply. */
export function useFieldCentroid(fieldId: string | null | undefined) {
  return useQuery({
    queryKey: ['field_centroids', 'v1', fieldId ?? ''],
    enabled: Boolean(fieldId),
    staleTime: 24 * 3_600_000,
    queryFn: async (): Promise<{ lat: number | null; lon: number | null } | null> => {
      const { data, error } = await supabase.from('field_centroids').select('lat, lon').eq('field_id', fieldId!).maybeSingle()
      if (error) throw error
      return data ? { lat: data.lat == null ? null : Number(data.lat), lon: data.lon == null ? null : Number(data.lon) } : null
    },
  })
}

/** "Not the same job": stop flagging this Deere pass against this record. */
export function useNotDuplicate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { rec: FieldWorkRecord; opId: string }) => {
      const next = [...new Set([...(v.rec.not_duplicate_of ?? []), v.opId])]
      const { error } = await supabase.from('field_work_records').update({ not_duplicate_of: next }).eq('id', v.rec.id)
      if (error) throw error
    },
    onSuccess: () => invalidate(qc),
  })
}

/**
 * Fill in the weather on records saved without it (no signal at the time, or
 * a finish time still to come), a few at a time, for records this person may
 * edit. A miss is stamped so the next open does not ask again for six hours.
 */
export function useFillMissingWeather(records: FieldWorkRecord[] | undefined, canEdit: (r: FieldWorkRecord) => boolean) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!records?.length || !navigator.onLine) return
    const due = records.filter((r) => canEdit(r) && weatherDue(r)).slice(0, 3)
    if (!due.length) return
    let cancelled = false
    void (async () => {
      let changed = false
      for (const r of due) {
        if (cancelled) return
        const wx = await weatherColumns(r)
        if (cancelled) return
        const { error } = await supabase.from('field_work_records').update(wx).eq('id', r.id)
        if (!error) changed = true
      }
      if (changed && !cancelled) void qc.invalidateQueries({ queryKey: ['field_work_records'] })
    })()
    return () => {
      cancelled = true
    }
    // Keyed on the records' ids and weather, not the array identity, so a refetch does not re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records?.map((r) => `${r.id}:${r.weather ? 1 : 0}:${r.weather_tried_at ?? ''}`).join('|')])
}

// ------------------------------------------------------------------ types (managers)

export function useSaveWorkType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { label: string; counts_as: FieldWorkType['counts_as'] }) => {
      const label = v.label.trim()
      // A type removed before is switched back on rather than added twice.
      const { data: all, error: e0 } = await supabase.from('field_work_types').select('id, label')
      if (e0) throw e0
      const old = (all ?? []).find((t) => t.label.trim().toLowerCase() === label.toLowerCase())
      const { error } = old
        ? await supabase.from('field_work_types').update({ label, counts_as: v.counts_as, active: true }).eq('id', old.id)
        : await supabase.from('field_work_types').insert({ label, counts_as: v.counts_as })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['field_work_types'] }),
  })
}

export function useDeleteWorkType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      // Kept, switched off: records already made with it still read its name.
      const { error } = await supabase.from('field_work_types').update({ active: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['field_work_types'] }),
  })
}

/** Short-lived links for a record's photos. Not kept on the device: they expire. */
export function useFieldWorkPhotoUrls(paths: string[]) {
  return useQuery({
    queryKey: ['field-work-photo-urls', paths],
    enabled: paths.length > 0,
    staleTime: 240_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 300)
      if (error) throw error
      return (data ?? []).map((d) => d.signedUrl).filter(Boolean) as string[]
    },
  })
}
