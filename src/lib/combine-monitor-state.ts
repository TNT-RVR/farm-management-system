import type { SupabaseClient } from '@supabase/supabase-js'
// Relative imports only: the hourly watch in netlify/shared bundles this file.
import {
  assignLineNames,
  assignMonitorNames,
  combineStatusByField,
  diffSnapshot,
  statusOf,
  type CombineStatus,
  isCombine,
  type EquipmentLite,
  type FieldChange,
  type MonitorLine,
  type MonitorName,
  type MonitorOverride,
  type MonitorSettings,
  type SnapshotField,
  type StoredLine,
} from './combine-monitor'
import { isCombineLine } from './guidance-lines'

/**
 * The app's side of the combine displays, read with whichever client is
 * asking: the browser's (Combines page, the missing-information checklist)
 * or the service role's (the hourly out-of-date watch). Either way the same
 * names and the same comparison, so the badge, the checklist line and the
 * notification can never disagree.
 */

/** One load: what a combine was given and when (combine_monitor_loads). */
export type MonitorLoad = {
  id: string
  equipment_id: string
  loaded_at: string
  loaded_by: string | null
  fields: SnapshotField[]
  loaded_count: number
  alerted_at: string | null
}

export type CombineMachine = EquipmentLite & { id: string; monitor: unknown }

export type CombineState = {
  machine: CombineMachine
  /** The latest load; null when nobody has marked one yet. */
  load: MonitorLoad | null
  /** Against the app now; empty with no load (nothing to compare with). */
  changes: FieldChange[]
}

type Page = PromiseLike<{ data: unknown; error: { message: string } | null }>

async function every<T>(page: (from: number, to: number) => Page): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Every active field as it would be loaded now: monitor name, file name, current boundary, status for the crop year. */
export async function loadCurrentSnapshot(sb: SupabaseClient, cropYear: number): Promise<SnapshotField[]> {
  return (await loadCurrent(sb, cropYear)).snapshot
}

/**
 * Each field's combine status for the crop year: plans and crop areas, and
 * the crops' on_combines switch. Before that column exists every crop counts
 * as on.
 */
async function loadStatus(sb: SupabaseClient, cropYear: number): Promise<Map<string, CombineStatus>> {
  type Row = { field_id: string; crop_id: string | null }
  const [plans, zones, crops] = await Promise.all([
    every<Row>((a, b) => sb.from('crop_plans').select('field_id, crop_id').eq('crop_year', cropYear).order('id').range(a, b)),
    every<Row>((a, b) => sb.from('field_crop_zones').select('field_id, crop_id').eq('crop_year', cropYear).order('id').range(a, b)),
    every<{ id: string; on_combines?: boolean | null }>((a, b) => sb.from('crops').select('id, on_combines').order('id').range(a, b)).catch(() => []),
  ])
  return combineStatusByField(plans, zones, crops)
}

/**
 * The Deere lines meant for the combines ("Combine" in the name), not
 * archived, with a shape to write. Empty before the table exists.
 */
async function loadCombineLines(sb: SupabaseClient): Promise<StoredLine[]> {
  try {
    const rows = await every<StoredLine & { archived: boolean; gtype: string | null }>((a, b) =>
      sb.from('jd_guidance_lines').select('id, field_id, name, line_type, heading_deg, data_hash, archived, gtype:geometry->>type').order('id').range(a, b),
    )
    return rows.filter((l) => !l.archived && l.gtype && isCombineLine(l.name))
  } catch {
    return []
  }
}

/** operating_settings key for the farm-wide Grower and own-land Farm. */
export const MONITOR_SETTINGS_KEY = 'combine_monitor'

/** What managers saved (blank parts unset), and the names in use: saved, else the farm's name from Farm setup. */
export type MonitorSettingsState = { saved: { grower: string | null; ownedFarm: string | null }; settings: MonitorSettings }

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** The farm-wide names. Before anything is saved, both are the farm's name on Farm setup. */
export async function loadMonitorSettings(sb: SupabaseClient): Promise<MonitorSettingsState> {
  const [saved, setup] = await Promise.all([
    sb.from('operating_settings').select('value').eq('key', MONITOR_SETTINGS_KEY).maybeSingle(),
    sb.from('farm_setup').select('farm_name').limit(1).maybeSingle(),
  ])
  const v = (saved.error ? null : saved.data?.value) as Record<string, unknown> | null
  const farmName = text((setup.data as { farm_name?: unknown } | null)?.farm_name) ?? 'Farm'
  const grower = text(v?.grower)
  const ownedFarm = text(v?.owned_farm)
  return { saved: { grower, ownedFarm }, settings: { grower: grower ?? farmName, ownedFarm: ownedFarm ?? farmName } }
}

/**
 * The landowner of each rented or crop-share field in the crop year: active
 * 'in' land deals, in term. Through fn_combine_monitor_landowners, because
 * the deals themselves (rent) are managers only; empty before it exists.
 */
async function loadLandowners(sb: SupabaseClient, cropYear: number): Promise<Map<string, string>> {
  const { data, error } = await sb.rpc('fn_combine_monitor_landowners', { p_crop_year: cropYear })
  if (error) return new Map()
  return new Map(((data ?? []) as { field_id: string; landowner: string | null }[]).filter((r) => r.landowner?.trim()).map((r) => [r.field_id, r.landowner!.trim()]))
}

/** Managers' names per field (combine_monitor_names); empty before the table exists. */
async function loadOverrides(sb: SupabaseClient): Promise<Map<string, MonitorOverride>> {
  try {
    const rows = await every<{ field_id: string; farm: string | null; field: string | null }>((a, b) => sb.from('combine_monitor_names').select('field_id, farm, field').order('id').range(a, b))
    return new Map(rows.map((r) => [r.field_id, { farm: r.farm, field: r.field }]))
  } catch {
    return new Map()
  }
}

export type CurrentMonitor = {
  snapshot: SnapshotField[]
  names: Map<string, MonitorName>
  lines: Map<string, MonitorLine[]>
  settings: MonitorSettingsState
  overrides: Map<string, MonitorOverride>
  landowners: Map<string, string>
}

/** The same, with each field's name details (farm, shortened, fractions…) and combine lines by field id. */
export async function loadCurrent(sb: SupabaseClient, cropYear: number): Promise<CurrentMonitor> {
  const [fields, bounds, stored, status, settings, landowners, overrides] = await Promise.all([
    every<{ id: string; name: string; active: boolean; legal_land_description: string | null }>((a, b) =>
      sb.from('fields').select('id, name, active, legal_land_description').order('id').range(a, b),
    ),
    every<{ id: string; field_id: string; valid_from: string | null; acres: unknown }>((a, b) =>
      sb.from('field_boundaries').select('id, field_id, valid_from, acres').is('valid_to', null).order('id').range(a, b),
    ),
    loadCombineLines(sb),
    loadStatus(sb, cropYear),
    loadMonitorSettings(sb),
    loadLandowners(sb, cropYear),
    loadOverrides(sb),
  ])
  const active = fields.filter((f) => f.active)
  const names = assignMonitorNames(
    active.map((f) => ({ id: f.id, name: f.name, legal: f.legal_land_description, landowner: landowners.get(f.id) ?? null, override: overrides.get(f.id) ?? null })),
    settings.settings,
  )
  const lines = assignLineNames(names, stored)
  // One current boundary per field is the rule; if two slip through, the newest wins.
  const bound = new Map<string, (typeof bounds)[number]>()
  for (const b of bounds) {
    const had = bound.get(b.field_id)
    if (!had || (b.valid_from ?? '') > (had.valid_from ?? '')) bound.set(b.field_id, b)
  }
  const snapshot = active.map((f) => {
    const n = names.get(f.id)!
    const b = bound.get(f.id)
    return {
      field_id: f.id,
      app_name: f.name,
      monitor_name: n.name,
      monitor_farm: n.farm,
      grower: n.grower,
      file_name: n.fileName,
      boundary_id: b?.id ?? null,
      valid_from: b?.valid_from ?? null,
      acres: b ? num(b.acres) : null,
      lines: (lines.get(f.id) ?? []).map((l) => ({ id: l.id, hash: l.hash, name: l.name })),
      status: statusOf(status, f.id),
    }
  })
  return { snapshot, names, lines, settings, overrides, landowners }
}

/** The fleet's combines, each with its latest load and what has changed since. */
export async function loadCombineStates(sb: SupabaseClient, cropYear: number, current?: SnapshotField[]): Promise<CombineState[]> {
  const [machines, now] = await Promise.all([
    every<CombineMachine>((a, b) => sb.from('jd_equipment').select('id, name, category, make, model, equipment_type, archived, monitor').eq('archived', false).order('id').range(a, b)),
    current ? Promise.resolve(current) : loadCurrentSnapshot(sb, cropYear),
  ])
  const combines = machines.filter(isCombine).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true }))
  // Only each combine's latest load: the history holds a whole snapshot a row.
  const loads = await Promise.all(
    combines.map(async (m) => {
      const { data, error } = await sb
        .from('combine_monitor_loads')
        .select('id, equipment_id, loaded_at, loaded_by, fields, loaded_count, alerted_at')
        .eq('equipment_id', m.id)
        .order('loaded_at', { ascending: false })
        .limit(1)
      if (error) throw new Error(error.message)
      return ((data ?? [])[0] as MonitorLoad | undefined) ?? null
    }),
  )
  return combines.map((machine, i) => {
    const load = loads[i]
    return { machine, load, changes: load ? diffSnapshot(Array.isArray(load.fields) ? load.fields : [], now) : [] }
  })
}
