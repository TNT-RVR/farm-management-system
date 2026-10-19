import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Json } from './database.types'
import { fetchAll } from './reports/framework'
import {
  MONITOR_NAME_MAX,
  fractionsToWords,
  keepIds,
  mergeSnapshot,
  shortenForMonitor,
  type MonitorInfo,
  type MonitorLine,
  type MonitorName,
  type MonitorOverride,
  type SnapshotField,
} from './combine-monitor'
import { MONITOR_SETTINGS_KEY, loadCombineStates, loadCurrent, loadCurrentSnapshot } from './combine-monitor-state'

/**
 * What the Combines page's Monitor files tab and its two reports read: every
 * active field with its Grower, Farm and Field on the display, mapped acres,
 * and this year's crop and variety. Geometry is not in it — a boundary is
 * fetched when the ZIP is made, so the cached list stays small.
 */

const sb = () => supabase as unknown as SupabaseClient

export type MonitorField = {
  id: string
  name: string
  /** Mapped acres of the current boundary; null with no boundary. */
  acres: number | null
  hasBoundary: boolean
  crops: string[]
  varieties: string[]
  /** On the combines this crop year: its planned crop or a crop area's crop has the switch on. */
  harvesting: boolean
  /** Its Grower, Farm, Field and file name on the display. */
  monitor: MonitorName
  /** The landowner on its land deal (rented or crop-share); null for our own land. */
  landowner: string | null
  /** A manager's Farm / Field for it, or null. */
  override: MonitorOverride | null
  /** Deere guidance lines with "Combine" in the name, as they go on the stick. */
  lines: MonitorLine[]
  /** The field as it would be loaded now, for "Mark loaded". */
  snapshot: SnapshotField
}

export type MonitorFieldList = {
  fields: MonitorField[]
  /** The Grower on the display, and the Farm for our own land. */
  grower: string
  ownedFarm: string
  /** What managers saved; null parts fall back to the farm's name. */
  saved: { grower: string | null; ownedFarm: string | null }
}

type PlanLite = { field_id: string; variety: string | null; crops: { name: string } | null }
type ZoneLite = { field_id: string; crops: { name: string } | null }

const CROP_COLS = 'name'

export async function loadMonitorFields(cropYear: number): Promise<MonitorFieldList> {
  const [current, plans, zones] = await Promise.all([
    loadCurrent(sb(), cropYear),
    fetchAll<PlanLite>((a, b) => supabase.from('crop_plans').select(`field_id, variety, crops(${CROP_COLS})`).eq('crop_year', cropYear).order('id').range(a, b)),
    fetchAll<ZoneLite>((a, b) => supabase.from('field_crop_zones').select(`field_id, crops(${CROP_COLS})`).eq('crop_year', cropYear).order('id').range(a, b)),
  ])
  const cropsBy = new Map<string, { name: string }[]>()
  const varietiesBy = new Map<string, string[]>()
  const zoned = new Set(zones.map((z) => z.field_id))
  // A split field's crops are its zones; a whole field's is its plan.
  for (const z of zones) if (z.crops) cropsBy.set(z.field_id, [...(cropsBy.get(z.field_id) ?? []), z.crops])
  for (const p of plans) {
    if (p.crops && !zoned.has(p.field_id)) cropsBy.set(p.field_id, [...(cropsBy.get(p.field_id) ?? []), p.crops])
    if (p.variety?.trim()) varietiesBy.set(p.field_id, [...(varietiesBy.get(p.field_id) ?? []), p.variety.trim()])
  }

  const { settings, saved } = current.settings
  return {
    grower: shortenForMonitor(settings.grower),
    ownedFarm: shortenForMonitor(settings.ownedFarm),
    saved,
    fields: current.snapshot.map((s) => {
      const crops = cropsBy.get(s.field_id) ?? []
      return {
        id: s.field_id,
        name: s.app_name,
        acres: s.acres,
        hasBoundary: s.boundary_id != null,
        crops: [...new Set(crops.map((c) => c.name))],
        varieties: [...new Set(varietiesBy.get(s.field_id) ?? [])],
        harvesting: s.status === 'on',
        monitor: current.names.get(s.field_id)!,
        landowner: current.landowners.get(s.field_id) ?? null,
        override: current.overrides.get(s.field_id) ?? null,
        lines: current.lines.get(s.field_id) ?? [],
        snapshot: s,
      }
    }),
  }
}

/** Current boundaries as GeoJSON for the fields asked, for the ZIP. */
export async function loadBoundaryGeometry(fieldIds: string[]): Promise<Map<string, Json>> {
  const out = new Map<string, Json>()
  for (let i = 0; i < fieldIds.length; i += 100) {
    const { data, error } = await supabase
      .from('field_boundaries_geojson')
      .select('field_id, geometry')
      .is('valid_to', null)
      .in('field_id', fieldIds.slice(i, i + 100))
    if (error) throw new Error(error.message)
    for (const r of data ?? []) if (r.geometry) out.set(r.field_id, r.geometry)
  }
  return out
}

/** The stored GeoJSON of these guidance lines, for the ZIP. */
export async function loadLineGeometry(lineIds: string[]): Promise<Map<string, Json>> {
  const out = new Map<string, Json>()
  for (let i = 0; i < lineIds.length; i += 100) {
    const { data, error } = await supabase.from('jd_guidance_lines').select('id, geometry').in('id', lineIds.slice(i, i + 100))
    if (error) throw new Error(error.message)
    for (const r of data ?? []) if (r.geometry) out.set(r.id, r.geometry)
  }
  return out
}

/**
 * Re-read every field's guidance lines from John Deere (managers). The
 * function answers 202 before it has done anything, so the list is
 * re-checked a few times after.
 */
export function useRefreshGuidanceLines() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/jd-guidance-sync-background', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } })
      if (res.status === 202 || res.ok) return { started: true }
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `Could not start the refresh (${res.status})`)
    },
    onSuccess: () => {
      for (const ms of [15_000, 45_000, 90_000]) {
        setTimeout(() => {
          void qc.invalidateQueries({ queryKey: ['combine_monitor_fields'] })
          void qc.invalidateQueries({ queryKey: ['combine_monitor_states'] })
        }, ms)
      }
    },
  })
}

export function monitorFieldsQuery(cropYear: number) {
  return {
    // v2: Grower / Farm / Field per field, landowner, override; no app farm (20261017030000).
    queryKey: ['combine_monitor_fields', 'v2', cropYear],
    queryFn: () => loadMonitorFields(cropYear),
  }
}

export function useMonitorFields(cropYear: number) {
  return useQuery(monitorFieldsQuery(cropYear))
}

export function combineStatesQuery(cropYear: number) {
  return {
    // v2: snapshots and changes carry the Farm and Grower (20261017030000).
    queryKey: ['combine_monitor_states', 'v2', cropYear],
    queryFn: () => loadCombineStates(sb(), cropYear),
  }
}

export function useCombineStates(cropYear: number) {
  return useQuery(combineStatesQuery(cropYear))
}

export type CombineCrop = { id: string; name: string; active: boolean; on_combines: boolean }

/** Every crop with its "Harvested with the combines" switch. */
export function combineCropsQuery() {
  return {
    // v1: crops.on_combines (20261017010000).
    queryKey: ['crops', 'on_combines', 'v1'],
    queryFn: async (): Promise<CombineCrop[]> => {
      const { data, error } = await supabase.from('crops').select('id, name, active, on_combines').order('name')
      if (error) throw error
      return (data ?? []).map((c) => ({ ...c, active: c.active !== false, on_combines: c.on_combines !== false }))
    },
  }
}

export function useCombineCrops() {
  return useQuery(combineCropsQuery())
}

/** Turn a crop's "Harvested with the combines" switch (managers); the badge and field picks follow at once. */
export function useSetCropOnCombines() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => {
      const { error } = await supabase.from('crops').update({ on_combines: on }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crops'] })
      void qc.invalidateQueries({ queryKey: ['combine_monitor_fields'] })
      void qc.invalidateQueries({ queryKey: ['combine_monitor_states'] })
    },
  })
}

const invalidateAll = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: ['combine_monitor_states'] })
  void qc.invalidateQueries({ queryKey: ['jd_equipment'] })
}

/** Record what a combine was just loaded with (managers). Fields not in this load keep what it had. */
export function useMarkLoaded() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ equipmentId, loaded, cropYear }: { equipmentId: string; loaded: SnapshotField[]; cropYear: number }) => {
      const [now, prev] = await Promise.all([
        loadCurrentSnapshot(sb(), cropYear),
        supabase.from('combine_monitor_loads').select('fields').eq('equipment_id', equipmentId).order('loaded_at', { ascending: false }).limit(1),
      ])
      if (prev.error) throw prev.error
      const previous = (prev.data?.[0]?.fields ?? []) as unknown as SnapshotField[]
      const fields = mergeSnapshot(Array.isArray(previous) ? previous : [], loaded, keepIds(now))
      const counted = keepIds(now)
      const { error } = await supabase
        .from('combine_monitor_loads')
        .insert({ equipment_id: equipmentId, fields: fields as unknown as Json, loaded_count: loaded.filter((f) => counted.has(f.field_id)).length })
      if (error) throw error
    },
    onSuccess: () => invalidateAll(qc),
  })
}

const invalidateNames = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: ['combine_monitor_fields'] })
  void qc.invalidateQueries({ queryKey: ['combine_monitor_states'] })
}

/** Why a typed display name can't be saved, or null. Blank is fine (automatic). */
export function monitorNameProblem(label: string, value: string | null | undefined): string | null {
  const s = fractionsToWords(value?.trim() ?? '')
  if (s.length > MONITOR_NAME_MAX) return `${label} is ${s.length} characters; the display takes ${MONITOR_NAME_MAX}.`
  return null
}

/** Save a field's Farm / Field on the display (managers). Both blank goes back to the automatic names. */
export function useSaveMonitorOverride() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ fieldId, farm, field }: { fieldId: string; farm: string | null; field: string | null }) => {
      const f = farm?.trim() || null
      const n = field?.trim() || null
      for (const p of [monitorNameProblem('Farm', f), monitorNameProblem('Field', n)]) if (p) throw new Error(p)
      const { error } =
        f || n
          ? await sb().from('combine_monitor_names').upsert({ field_id: fieldId, farm: f, field: n, updated_at: new Date().toISOString() }, { onConflict: 'field_id' })
          : await sb().from('combine_monitor_names').delete().eq('field_id', fieldId)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => invalidateNames(qc),
  })
}

/** Save the farm-wide Grower and own-land Farm (managers). Blank = the farm's name from Farm setup. */
export function useSaveMonitorSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ grower, ownedFarm }: { grower: string | null; ownedFarm: string | null }) => {
      const g = grower?.trim() || null
      const o = ownedFarm?.trim() || null
      for (const p of [monitorNameProblem('Grower', g), monitorNameProblem('Farm', o)]) if (p) throw new Error(p)
      const { error } = await sb()
        .from('operating_settings')
        .upsert({ key: MONITOR_SETTINGS_KEY, value: { grower: g, owned_farm: o }, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => invalidateNames(qc),
  })
}

/** Save a combine's display record (managers); an empty one is stored as null. */
export function useSaveMonitorInfo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ equipmentId, info }: { equipmentId: string; info: MonitorInfo | null }) => {
      const monitor = info && Object.keys(info).length ? (info as Json) : null
      const { error } = await supabase.from('jd_equipment').update({ monitor, updated_at: new Date().toISOString() }).eq('id', equipmentId)
      if (error) throw error
    },
    onSuccess: () => invalidateAll(qc),
  })
}
