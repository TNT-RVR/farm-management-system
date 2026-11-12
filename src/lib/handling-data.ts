import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import { referenceStale } from './stale'

/**
 * The Handling System designer's reads and writes. The arithmetic is in
 * handling.ts; the map is in pages/cattle/handling.
 *
 * Everything is keyed on the yard (`site`) except the layout itself, which is
 * keyed on the version. That split is the point of the tool: two concepts for
 * the same yard are comparable because the kit, the inventory and the herd
 * behind them are the same.
 */

type T = Database['public']['Tables']
export type SiteRow = T['handling_sites']['Row']
export type VersionRow = T['handling_versions']['Row']
export type CatalogRow = T['handling_catalog']['Row']
export type ItemRow = T['handling_items']['Row']
export type PathRow = T['handling_paths']['Row']
export type LayerRow = T['handling_layers']['Row']

const KEY = 'handling'

const n = (v: unknown): number => Number(v ?? 0)
const maybe = (v: unknown): number | null => (v == null ? null : Number(v))

/** Every corral yard, with the ranch it belongs to. */
export function useHandlingSites() {
  return useQuery({
    queryKey: [KEY, 'sites'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('handling_sites')
        .select('*')
        .order('sort_order')
        .order('name')
      if (error) throw error
      return (data ?? []).map((s) => ({
        ...s,
        center_lng: maybe(s.center_lng),
        center_lat: maybe(s.center_lat),
        zoom: maybe(s.zoom),
      })) as SiteRow[]
    },
    staleTime: referenceStale,
  })
}

export function useSiteMutations() {
  const qc = useQueryClient()
  const done = () => void qc.invalidateQueries({ queryKey: [KEY] })

  /** A new yard starts with its base layout, because a yard with no layout has no screen. */
  const add = useMutation({
    mutationFn: async (row: T['handling_sites']['Insert']) => {
      const { data, error } = await supabase.from('handling_sites').insert(row).select('id').single()
      if (error) throw error
      const { error: vErr } = await supabase
        .from('handling_versions')
        .insert({ site_id: data.id, name: 'Base — current setup', is_base: true, sort_order: 0 })
      if (vErr) throw vErr
      return data.id as string
    },
    onSuccess: done,
  })

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: T['handling_sites']['Update'] }) => {
      const { error } = await supabase
        .from('handling_sites')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: done,
  })

  /**
   * Where the map was left. Written on every pan and zoom, so it does not
   * invalidate anything — a view save that re-rendered the map would fight the
   * hand that moved it.
   */
  const saveView = useMutation({
    mutationFn: async ({ id, lng, lat, zoom }: { id: string; lng: number; lat: number; zoom: number }) => {
      const { error } = await supabase
        .from('handling_sites')
        .update({ center_lng: lng, center_lat: lat, zoom })
        .eq('id', id)
      if (error) throw error
    },
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('handling_sites').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: done,
  })

  return { add, update, saveView, remove }
}

/** A yard's layouts, base first. */
export function useHandlingVersions(siteId: string | null | undefined) {
  return useQuery({
    queryKey: [KEY, 'versions', siteId],
    enabled: Boolean(siteId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('handling_versions')
        .select('*')
        .eq('site_id', siteId!)
        .order('is_base', { ascending: false })
        .order('sort_order')
        .order('created_at')
      if (error) throw error
      return (data ?? []) as VersionRow[]
    },
  })
}

export function useVersionMutations() {
  const qc = useQueryClient()
  const done = () => void qc.invalidateQueries({ queryKey: [KEY] })

  const add = useMutation({
    mutationFn: async ({ siteId, name, notes }: { siteId: string; name: string; notes?: string | null }) => {
      const { data, error } = await supabase
        .from('handling_versions')
        .insert({ site_id: siteId, name, notes: notes ?? null, sort_order: Date.now() % 100000 })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: done,
  })

  /**
   * A concept copied from another, panels and pens and all.
   *
   * Copied here rather than in a database function because the rows are few —
   * a big yard is a couple of hundred panels — and a plpgsql copy of two
   * tables is a thing that silently stops copying the third when a column is
   * added.
   */
  const duplicate = useMutation({
    mutationFn: async ({ fromId, siteId, name }: { fromId: string; siteId: string; name: string }) => {
      const { data: v, error } = await supabase
        .from('handling_versions')
        .insert({ site_id: siteId, name, sort_order: Date.now() % 100000 })
        .select('id')
        .single()
      if (error) throw error
      const to = v.id as string

      const [items, paths] = await Promise.all([
        supabase.from('handling_items').select('catalog_id, lng, lat, rotation, swing_deg').eq('version_id', fromId),
        supabase
          .from('handling_paths')
          .select('points, is_closed, label, color, stroke_width, usage_type, assigned_classes')
          .eq('version_id', fromId),
      ])
      if (items.error) throw items.error
      if (paths.error) throw paths.error

      if (items.data?.length) {
        const { error: e } = await supabase
          .from('handling_items')
          .insert(items.data.map((i) => ({ ...i, version_id: to })))
        if (e) throw e
      }
      if (paths.data?.length) {
        const { error: e } = await supabase
          .from('handling_paths')
          .insert(paths.data.map((p) => ({ ...p, version_id: to })))
        if (e) throw e
      }
      return to
    },
    onSuccess: done,
  })

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: T['handling_versions']['Update'] }) => {
      const { error } = await supabase
        .from('handling_versions')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: done,
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('handling_versions').delete().eq('id', id).eq('is_base', false)
      if (error) throw error
    },
    onSuccess: done,
  })

  return { add, duplicate, update, remove }
}

/** The built-in kit plus whatever this yard has added. */
export function useHandlingCatalog(siteId: string | null | undefined) {
  return useQuery({
    queryKey: [KEY, 'catalog', siteId],
    queryFn: async () => {
      let q = supabase.from('handling_catalog').select('*').order('sort_order').order('name')
      q = siteId ? q.or(`site_id.is.null,site_id.eq.${siteId}`) : q.is('site_id', null)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []).map((c) => ({
        ...c,
        width_ft: n(c.width_ft),
        depth_ft: n(c.depth_ft),
        height_ft: n(c.height_ft),
      })) as CatalogRow[]
    },
    staleTime: referenceStale,
  })
}

export function useCatalogMutations() {
  const qc = useQueryClient()
  const done = () => void qc.invalidateQueries({ queryKey: [KEY] })
  const add = useMutation({
    mutationFn: async (row: T['handling_catalog']['Insert']) => {
      const { error } = await supabase.from('handling_catalog').insert(row)
      if (error) throw error
    },
    onSuccess: done,
  })
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: T['handling_catalog']['Update'] }) => {
      const { error } = await supabase.from('handling_catalog').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: done,
  })
  /** Only a yard's own additions; the built-in kit is shared and stays. */
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('handling_catalog').delete().eq('id', id).not('site_id', 'is', null)
      if (error) throw error
    },
    onSuccess: done,
  })
  return { add, update, remove }
}

export type Layout = { items: ItemRow[]; paths: PathRow[] }

/** Everything drawn on one version. */
export function useLayout(versionId: string | null | undefined) {
  return useQuery({
    queryKey: [KEY, 'layout', versionId],
    enabled: Boolean(versionId),
    queryFn: async (): Promise<Layout> => {
      const [items, paths] = await Promise.all([
        supabase.from('handling_items').select('*').eq('version_id', versionId!),
        supabase.from('handling_paths').select('*').eq('version_id', versionId!),
      ])
      if (items.error) throw items.error
      if (paths.error) throw paths.error
      return {
        items: (items.data ?? []).map((i) => ({
          ...i,
          lng: n(i.lng),
          lat: n(i.lat),
          rotation: n(i.rotation),
          swing_deg: n(i.swing_deg),
        })) as ItemRow[],
        paths: (paths.data ?? []).map((p) => ({
          ...p,
          stroke_width: n(p.stroke_width),
          points: ((p.points ?? []) as [number, number][]).map(([lng, lat]) => [Number(lng), Number(lat)]),
        })) as PathRow[],
      }
    },
  })
}

/**
 * Layout writes.
 *
 * Every one of them stamps the version as changed and by whom: a yard four
 * people lay out needs to say whose hand moved the panel, which the
 * single-user prototype never had to.
 */
export function useLayoutMutations(versionId: string | null | undefined) {
  const qc = useQueryClient()
  const done = () => {
    void qc.invalidateQueries({ queryKey: [KEY, 'layout', versionId] })
    void qc.invalidateQueries({ queryKey: [KEY, 'versions'] })
  }
  /**
   * Show the change before the round trip finishes.
   *
   * Dragging a panel and watching it spring back for 150 ms reads as the tool
   * fighting you. The map holds the position only while the mouse is down and
   * hands it over here on release, so this is what covers the gap until the
   * refetch lands. `onSettled` invalidates either way, so a write that failed
   * puts the real row back rather than leaving a lie on the screen.
   */
  const patchCache = (fn: (l: Layout) => Layout) =>
    qc.setQueryData<Layout>([KEY, 'layout', versionId], (old) => (old ? fn(old) : old))
  const touch = async () => {
    if (!versionId) return
    const { data } = await supabase.auth.getUser()
    await supabase
      .from('handling_versions')
      .update({ updated_at: new Date().toISOString(), updated_by: data.user?.id ?? null })
      .eq('id', versionId)
  }

  const addItem = useMutation({
    mutationFn: async (row: Omit<T['handling_items']['Insert'], 'version_id'>) => {
      const { data, error } = await supabase
        .from('handling_items')
        .insert({ ...row, version_id: versionId! })
        .select('id')
        .single()
      if (error) throw error
      await touch()
      return data.id as string
    },
    onSuccess: done,
  })

  const moveItem = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: T['handling_items']['Update'] }) => {
      const { error } = await supabase.from('handling_items').update(patch).eq('id', id)
      if (error) throw error
      await touch()
    },
    onMutate: ({ id, patch }) =>
      patchCache((l) => ({ ...l, items: l.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
    onSettled: done,
  })

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('handling_items').delete().eq('id', id)
      if (error) throw error
      await touch()
    },
    onMutate: (id) => patchCache((l) => ({ ...l, items: l.items.filter((i) => i.id !== id) })),
    onSettled: done,
  })

  /**
   * The stored row comes back, not just its id.
   *
   * Undo needs it. A pen drawn on the map says only where its corners are and
   * lets the database fill in the colour, the line width and what the pen is
   * for; recording the insert from what was SENT would mean an undone pen came
   * back in whatever colour this page happened to guess.
   */
  const addPath = useMutation({
    mutationFn: async (row: Omit<T['handling_paths']['Insert'], 'version_id'>) => {
      const { data, error } = await supabase
        .from('handling_paths')
        .insert({ ...row, version_id: versionId! })
        .select('id, points, is_closed, label, color, stroke_width, usage_type, assigned_classes')
        .single()
      if (error) throw error
      await touch()
      return {
        ...data,
        stroke_width: n(data.stroke_width),
        points: ((data.points ?? []) as [number, number][]).map(([lng, lat]) => [Number(lng), Number(lat)]) as [
          number,
          number,
        ][],
      }
    },
    onSuccess: done,
  })

  const updatePath = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: T['handling_paths']['Update'] }) => {
      const { error } = await supabase.from('handling_paths').update(patch).eq('id', id)
      if (error) throw error
      await touch()
    },
    onMutate: ({ id, patch }) =>
      patchCache((l) => ({ ...l, paths: l.paths.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
    onSettled: done,
  })

  /**
   * Deleting a pen deletes the pen. The prototype kept the enclosure in a
   * second table and left it behind in the lists — one row means that bug
   * cannot be written again.
   */
  const removePath = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('handling_paths').delete().eq('id', id)
      if (error) throw error
      await touch()
    },
    onMutate: (id) => patchCache((l) => ({ ...l, paths: l.paths.filter((p) => p.id !== id) })),
    onSettled: done,
  })

  return { addItem, moveItem, removeItem, addPath, updatePath, removePath }
}

/** How many of each the yard owns, keyed by catalog id. */
export function useHandlingInventory(siteId: string | null | undefined) {
  return useQuery({
    queryKey: [KEY, 'inventory', siteId],
    enabled: Boolean(siteId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('handling_inventory')
        .select('catalog_id, quantity')
        .eq('site_id', siteId!)
      if (error) throw error
      const out: Record<string, number> = {}
      for (const r of data ?? []) out[r.catalog_id] = r.quantity
      return out
    },
  })
}

export function useInventoryMutations(siteId: string | null | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ catalogId, quantity }: { catalogId: string; quantity: number }) => {
      const { error } = await supabase.from('handling_inventory').upsert(
        {
          site_id: siteId!,
          catalog_id: catalogId,
          quantity: Math.max(0, Math.round(quantity)),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'site_id,catalog_id' },
      )
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: [KEY, 'inventory', siteId] }),
  })
}

/** Uploaded KML drawn under the layout: power, water, gas. */
export function useHandlingLayers(siteId: string | null | undefined) {
  return useQuery({
    queryKey: [KEY, 'layers', siteId],
    enabled: Boolean(siteId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('handling_layers')
        .select('*')
        .eq('site_id', siteId!)
        .order('created_at')
      if (error) throw error
      return (data ?? []) as LayerRow[]
    },
  })
}

export function useLayerMutations(siteId: string | null | undefined) {
  const qc = useQueryClient()
  const done = () => void qc.invalidateQueries({ queryKey: [KEY, 'layers', siteId] })
  const add = useMutation({
    mutationFn: async (row: Omit<T['handling_layers']['Insert'], 'site_id'>) => {
      const { error } = await supabase.from('handling_layers').insert({ ...row, site_id: siteId! })
      if (error) throw error
    },
    onSuccess: done,
  })
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: T['handling_layers']['Update'] }) => {
      const { error } = await supabase.from('handling_layers').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: done,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('handling_layers').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: done,
  })
  return { add, update, remove }
}
