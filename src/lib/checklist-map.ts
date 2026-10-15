import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LineString, Point } from 'geojson'
import { supabase } from './supabase'
import { shrinkPhoto } from './scouting'

/**
 * Checklists that live on a map (migration 20261007010000): places with their
 * own instructions, photos and jobs. The template's places are the admin's;
 * each year's run copies them and adds its own notes and photos.
 *
 * The new tables are read through an untyped handle and shaped into exact
 * types on the way out.
 */
const db = supabase as unknown as SupabaseClient

export type PlaceGeometry = Point | LineString

export type TemplateLocation = {
  id: string
  template_id: string
  name: string
  geojson: PlaceGeometry
  instructions_md: string | null
  sort_order: number
  source: string | null
  /** The farm-map item it was made from; it moves when that does. */
  feature_id: string | null
  /** The kind of job ("Blow out", "Pump out"…) and that kind's map colour. */
  category: string | null
  colour: string | null
}

export type RunLocation = {
  id: string
  run_id: string
  template_location_id: string | null
  name: string
  geojson: PlaceGeometry
  instructions_md: string | null
  sort_order: number
  note: string | null
  note_by: string | null
  note_at: string | null
  category: string | null
  colour: string | null
}

export type ChecklistPhoto = {
  id: string
  template_location_id: string | null
  run_location_id: string | null
  storage_path: string
  caption: string | null
  created_by: string | null
  created_at: string
}

export type PlaceStatus = 'done' | 'partial' | 'todo'

/** A place is done when every job at it is ticked. */
export function placeStatus(items: { checked: boolean }[]): PlaceStatus {
  if (!items.length) return 'todo'
  const n = items.filter((i) => i.checked).length
  return n === items.length ? 'done' : n > 0 ? 'partial' : 'todo'
}

export const STATUS_COLOUR: Record<PlaceStatus, string> = { done: '#16a34a', partial: '#f59e0b', todo: '#dc2626' }

/** A place with no job type of its own is drawn in this. */
export const PLAIN_COLOUR = '#38bdf8'

/** The job types on a set of places, with their colours, for a legend. */
export function categoriesOf(places: { category: string | null; colour: string | null }[]): { category: string; colours: string[] }[] {
  const m = new Map<string, Set<string>>()
  for (const p of places) {
    if (!p.category) continue
    const s = m.get(p.category) ?? new Set<string>()
    s.add(p.colour ?? PLAIN_COLOUR)
    m.set(p.category, s)
  }
  return [...m].map(([category, cs]) => ({ category, colours: [...cs] }))
}
export const STATUS_LABEL: Record<PlaceStatus, string> = { done: 'Done', partial: 'Started', todo: 'Not started' }

/** Where to put a label or a tap target for a line: its middle vertex. */
export function anchorOf(g: PlaceGeometry): [number, number] {
  if (g.type === 'Point') return g.coordinates as [number, number]
  const c = g.coordinates
  return c[Math.floor((c.length - 1) / 2)] as [number, number]
}

/* ------------------------------------------------------------ template side */

export function useTemplateLocations(templateId: string | undefined) {
  return useQuery({
    enabled: Boolean(templateId),
    queryKey: ['checklist_template_locations', templateId],
    queryFn: async (): Promise<TemplateLocation[]> => {
      const { data, error } = await db
        .from('checklist_template_locations')
        .select('id, template_id, name, geojson, instructions_md, sort_order, source, feature_id, category, colour')
        .eq('template_id', templateId!)
        .order('sort_order')
        .order('name')
      if (error) throw error
      return (data ?? []) as TemplateLocation[]
    },
  })
}

export function useSaveTemplateLocation(templateId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (l: Partial<TemplateLocation> & { name: string; geojson: PlaceGeometry }) => {
      const row = { ...l, template_id: templateId, updated_at: new Date().toISOString() }
      const { data, error } = l.id
        ? await db.from('checklist_template_locations').update(row).eq('id', l.id).select('id').single()
        : await db.from('checklist_template_locations').insert(row).select('id').single()
      if (error) throw error
      return (data as { id: string }).id
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['checklist_template_locations', templateId] }),
  })
}

/** Add many places at once (from the My Map or the pump list). */
export function useAddTemplateLocations(templateId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rows: { name: string; geojson: PlaceGeometry; source: string; sort_order: number; feature_id?: string | null }[]) => {
      if (!rows.length) return
      const { error } = await db.from('checklist_template_locations').insert(rows.map((r) => ({ ...r, template_id: templateId })))
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['checklist_template_locations', templateId] }),
  })
}

export function useDeleteTemplateLocation(templateId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from('checklist_template_locations').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['checklist_template_locations', templateId] })
      void qc.invalidateQueries({ queryKey: ['checklist_template_items', templateId] })
    },
  })
}

/** Jobs at a place, on the template. */
export function useSaveLocationItem(templateId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (i: { id?: string; location_id: string; text: string; sort_order: number; requires_note?: boolean }) => {
      const row = { template_id: templateId, location_id: i.location_id, text: i.text, sort_order: i.sort_order, requires_note: i.requires_note ?? false }
      const { error } = i.id
        ? await supabase.from('checklist_template_items').update(row).eq('id', i.id)
        : await supabase.from('checklist_template_items').insert(row)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['checklist_template_items', templateId] }),
  })
}

export function useDeleteTemplateItem(templateId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('checklist_template_items').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['checklist_template_items', templateId] }),
  })
}

/* ----------------------------------------------------------------- run side */

export function useRunLocations(runId: string | undefined) {
  return useQuery({
    enabled: Boolean(runId),
    queryKey: ['checklist_run_locations', runId],
    queryFn: async (): Promise<RunLocation[]> => {
      const { data, error } = await db
        .from('checklist_run_locations')
        .select('id, run_id, template_location_id, name, geojson, instructions_md, sort_order, note, note_by, note_at, category, colour')
        .eq('run_id', runId!)
        .order('sort_order')
        .order('name')
      if (error) throw error
      return (data ?? []) as RunLocation[]
    },
  })
}

export function useSaveRunNote(runId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string | null }) => {
      const { error } = await db.from('checklist_run_locations').update({ note }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['checklist_run_locations', runId] }),
  })
}

/**
 * Carry a year's note into the template's instructions, so next year's crew
 * starts with what this year's learned. Managers only (the template's RLS).
 */
export function useNoteToTemplate(templateId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    // Through the database (checklist_note_to_template), so whoever is out
    // doing the job can pass on what they learned, not only a manager — it
    // adds to the instructions with the year and their name, never rewrites.
    mutationFn: async (runLocationId: string) => {
      const { error } = await db.rpc('checklist_note_to_template', { p_run_location: runLocationId })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['checklist_template_locations', templateId] }),
  })
}

/** Show this year's photo on the template too, as a how-to for next year (same file). */
export function usePhotoToTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (photoIds: string[]) => {
      for (const id of photoIds) {
        const { error } = await db.rpc('checklist_photo_to_template', { p_photo: id })
        if (error) throw error
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['checklist_photos'] }),
  })
}

/** This year's run of a yearly checklist, made from the template if it doesn't exist yet. */
export function useEnsureYearRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ templateId, year }: { templateId: string; year?: number }) => {
      const { data, error } = await db.rpc('ensure_checklist_year_run', { p_template: templateId, p_year: year ?? null })
      if (error) throw error
      return data as string
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['checklist_runs'] }),
  })
}

/* ------------------------------------------------------------------- photos */

type PhotoTarget = { templateLocationIds?: string[]; runLocationIds?: string[] }

export function usePhotos(t: PhotoTarget) {
  const ids = [...(t.templateLocationIds ?? []), ...(t.runLocationIds ?? [])]
  return useQuery({
    enabled: ids.length > 0,
    queryKey: ['checklist_photos', t.templateLocationIds ?? [], t.runLocationIds ?? []],
    queryFn: async (): Promise<ChecklistPhoto[]> => {
      const or = [
        t.templateLocationIds?.length ? `template_location_id.in.(${t.templateLocationIds.join(',')})` : null,
        t.runLocationIds?.length ? `run_location_id.in.(${t.runLocationIds.join(',')})` : null,
      ].filter(Boolean)
      const { data, error } = await db
        .from('checklist_photos')
        .select('id, template_location_id, run_location_id, storage_path, caption, created_by, created_at')
        .or(or.join(','))
        .order('created_at')
      if (error) throw error
      return (data ?? []) as ChecklistPhoto[]
    },
  })
}

/** Signed links for a set of photos (private bucket; links last an hour). */
export function usePhotoUrls(paths: string[]) {
  return useQuery({
    enabled: paths.length > 0,
    queryKey: ['checklist_photo_urls', paths],
    staleTime: 50 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.storage.from('checklist-photos').createSignedUrls(paths, 3600)
      if (error) throw error
      const out: Record<string, string> = {}
      for (const d of data ?? []) if (d.signedUrl && d.path) out[d.path] = d.signedUrl
      return out
    },
  })
}

export function useAddPhoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, templateLocationId, runLocationId, caption }: { file: File; templateLocationId?: string; runLocationId?: string; caption?: string }) => {
      const blob = await shrinkPhoto(file)
      const owner = templateLocationId ? `template/${templateLocationId}` : `run/${runLocationId}`
      const path = `${owner}/${crypto.randomUUID()}.jpg`
      const up = await supabase.storage.from('checklist-photos').upload(path, blob, { contentType: 'image/jpeg' })
      if (up.error) throw up.error
      const { error } = await db.from('checklist_photos').insert({
        template_location_id: templateLocationId ?? null,
        run_location_id: runLocationId ?? null,
        storage_path: path,
        caption: caption?.trim() || null,
      })
      if (error) {
        await supabase.storage.from('checklist-photos').remove([path])
        throw error
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['checklist_photos'] }),
  })
}

export function useDeletePhoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: ChecklistPhoto) => {
      const { error } = await db.from('checklist_photos').delete().eq('id', p.id)
      if (error) throw error
      // A photo kept for next year is the same file on the template; the file
      // goes only when nothing shows it any more.
      const { count } = await db.from('checklist_photos').select('id', { count: 'exact', head: true }).eq('storage_path', p.storage_path)
      if (!count) await supabase.storage.from('checklist-photos').remove([p.storage_path])
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['checklist_photos'] }),
  })
}
