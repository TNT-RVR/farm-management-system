import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Geometry } from 'geojson'
import { supabase } from './supabase'
import { TRAIT_SHORT, asTrait } from './canola-trait'
import { companyLookup } from './crop-label'
import { seedCanolaYear, type SeedCanola } from './seed-canola-year'
import type { QuarterOwner } from './canola-isolation-core'

export * from './canola-isolation-core'

/**
 * The hooks behind the canola isolation and field history reports
 * (quarter_crops, quarter_owners, canola_isolation_reports,
 * field_isolation_area). All but quarter_owners are missing from
 * database.types: those are read through an untyped handle.
 */
const db = supabase as unknown as SupabaseClient

export type IsolationArea = { field: Geometry | null; area: Geometry | null; ours: { field_id: string; geometry: Geometry }[] }

export function useIsolationArea(fieldId: string | null, metres: number) {
  return useQuery({
    queryKey: ['field-isolation-area', fieldId, metres],
    enabled: Boolean(fieldId),
    queryFn: async () => {
      const { data, error } = await db.rpc('field_isolation_area', { p_field: fieldId, p_metres: metres })
      if (error) throw error
      return data as IsolationArea
    },
  })
}

export type QuarterLabel = { parcel: string; crop_year: number; crop: string | null; notes: string | null }

/** What has been written on these quarters, keyed "parcel|year". */
export function useQuarterCrops(parcels: string[]) {
  const key = [...parcels].sort()
  return useQuery({
    queryKey: ['quarter-crops', key],
    enabled: parcels.length > 0,
    queryFn: async () => {
      const out = new Map<string, { crop: string | null; notes: string | null }>()
      for (let k = 0; k < key.length; k += 150) {
        const { data, error } = await db.from('quarter_crops').select('parcel, crop_year, crop, notes').in('parcel', key.slice(k, k + 150))
        if (error) throw error
        for (const r of (data ?? []) as QuarterLabel[]) out.set(`${r.parcel}|${r.crop_year}`, { crop: r.crop, notes: r.notes })
      }
      return out
    },
  })
}

/** Write what is on a quarter in a year; a blank crop and note clears it. */
export function useSaveQuarterCrop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (r: QuarterLabel) => {
      const crop = r.crop?.trim() || null
      const notes = r.notes?.trim() || null
      if (!crop && !notes) {
        const { error } = await db.from('quarter_crops').delete().eq('parcel', r.parcel).eq('crop_year', r.crop_year)
        if (error) throw error
        return
      }
      const { error } = await db
        .from('quarter_crops')
        .upsert({ parcel: r.parcel, crop_year: r.crop_year, crop, notes, updated_at: new Date().toISOString() }, { onConflict: 'parcel,crop_year' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quarter-crops'] }),
  })
}

/** Who has these quarters (pasture or a neighbour), keyed by parcel. */
export function useQuarterOwners(parcels: string[]) {
  const key = [...parcels].sort()
  return useQuery({
    queryKey: ['quarter-owners', key],
    enabled: parcels.length > 0,
    queryFn: async () => {
      const out = new Map<string, QuarterOwner>()
      for (let k = 0; k < key.length; k += 150) {
        const { data, error } = await supabase.from('quarter_owners').select('id, parcel, kind, owner_name, phone, email, notes').in('parcel', key.slice(k, k + 150))
        if (error) throw error
        for (const r of data ?? []) out.set(r.parcel, r)
      }
      return out
    },
  })
}

/** Every owner already written down, for filling a new quarter from one: newest entry per name. */
export function useKnownOwners() {
  return useQuery({
    queryKey: ['quarter-owners', 'names'],
    queryFn: async () => {
      const { data, error } = await supabase.from('quarter_owners').select('owner_name, phone, email, updated_at').not('owner_name', 'is', null).order('updated_at', { ascending: false })
      if (error) throw error
      const out = new Map<string, { owner_name: string; phone: string | null; email: string | null }>()
      for (const r of data ?? []) {
        const name = r.owner_name?.trim()
        if (name && !out.has(name.toLowerCase())) out.set(name.toLowerCase(), { owner_name: name, phone: r.phone, email: r.email })
      }
      return [...out.values()].sort((a, b) => a.owner_name.localeCompare(b.owner_name))
    },
  })
}

/** Mark a quarter as pasture or a neighbour's (one row per quarter). */
export function useSaveQuarterOwner() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (r: Omit<QuarterOwner, 'id'>) => {
      const t = (s: string | null | undefined) => s?.trim() || null
      const row = { parcel: r.parcel, kind: r.kind, owner_name: t(r.owner_name), phone: t(r.phone), email: t(r.email), notes: t(r.notes) }
      if (row.kind === 'neighbour' && !row.owner_name) throw new Error('A neighbour’s land needs the owner’s name.')
      const { error } = await supabase.from('quarter_owners').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'parcel' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quarter-owners'] }),
  })
}

export function useDeleteQuarterOwner() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (parcel: string) => {
      const { error } = await supabase.from('quarter_owners').delete().eq('parcel', parcel)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quarter-owners'] }),
  })
}

export type FieldYear = {
  fieldId: string
  year: number
  crop: string
  /** The crop as the reports print it: a canola year with its company and trait, "Seed canola: Corteva Roundup Ready". */
  display: string
  variety: string | null
  acres: number | null
  yield: string | null
  from: 'history' | 'plan'
  /** The year's seed canola, company and trait; null when it was not canola. */
  canola: SeedCanola | null
  /** Where the year's record is, to set its trait. */
  record: { table: 'crop_history' | 'crop_plans'; id: string; trait: string | null } | null
}

type CropRow = { id: string; name: string; herbicide_trait: string | null; category?: string | null }

/** A crop's name with its canola trait when the name doesn't already say it: "BASF Canola (Liberty)". */
export function cropName(c: CropRow | undefined): string | null {
  if (!c) return null
  const trait = asTrait(c.herbicide_trait)
  if (!trait || new RegExp(TRAIT_SHORT[trait], 'i').test(c.name)) return c.name
  return `${c.name} (${TRAIT_SHORT[trait]})`
}

/**
 * Our fields' crops by year: the crop history where there is one (what was
 * grown), else the crop plan (this year and ahead), and a split field's crop
 * areas together ("Grain Corn + Carrots").
 */
export function useFieldYears(fieldIds: string[], years: number[]) {
  const ids = [...new Set(fieldIds)].sort()
  return useQuery({
    queryKey: ['field-years', ids, years],
    enabled: ids.length > 0 && years.length > 0,
    queryFn: async () => {
      const lo = Math.min(...years)
      const hi = Math.max(...years)
      const [crops, hist, plans, zones, varieties] = await Promise.all([
        db.from('crops').select('id, name, herbicide_trait, category'),
        db.from('crop_yields_v').select('id, field_id, crop_year, crop_id, variety, acres, yield_per_acre, clean_yield_per_acre, yield_unit, herbicide_trait').in('field_id', ids).gte('crop_year', lo).lte('crop_year', hi),
        db.from('crop_plans').select('id, field_id, crop_year, crop_id, variety, planned_acres, herbicide_trait').in('field_id', ids).gte('crop_year', lo).lte('crop_year', hi),
        db.from('field_crop_zones').select('field_id, crop_year, crop_id, acres').in('field_id', ids).gte('crop_year', lo).lte('crop_year', hi),
        db.from('crop_varieties').select('crop_id, name, company'),
      ])
      for (const r of [crops, hist, plans, zones, varieties]) if (r.error) throw r.error
      const cropRows = (crops.data ?? []) as CropRow[]
      const byId = new Map(cropRows.map((c) => [c.id, c]))
      const companyOf = companyLookup((varieties.data ?? []) as { crop_id: string; name: string; company: string | null }[])
      const canolaOf = (cropId: unknown, variety: unknown, trait: unknown) =>
        seedCanolaYear({ crop: byId.get(String(cropId)), variety: (variety as string) ?? null, yearTrait: (trait as string) ?? null, crops: cropRows, companyOf })
      // A canola year reads as the company and system: "Seed canola: Corteva Roundup Ready".
      const shown = (name: string, c: SeedCanola | null) => (c ? (c.company ? `Seed canola: ${c.label}` : c.label) : name)
      const out = new Map<string, FieldYear>()
      const put = (f: FieldYear) => !out.has(`${f.fieldId}|${f.year}`) && out.set(`${f.fieldId}|${f.year}`, f)
      for (const h of (hist.data ?? []) as Record<string, unknown>[]) {
        const name = cropName(byId.get(String(h.crop_id)))
        if (!name) continue
        const y = h.clean_yield_per_acre ?? h.yield_per_acre
        const canola = canolaOf(h.crop_id, h.variety, h.herbicide_trait)
        put({
          fieldId: String(h.field_id),
          year: Number(h.crop_year),
          crop: name,
          display: shown(name, canola),
          canola,
          record: { table: 'crop_history', id: String(h.id), trait: (h.herbicide_trait as string) ?? null },
          variety: (h.variety as string) ?? null,
          acres: h.acres == null ? null : Number(h.acres),
          yield: y == null ? null : `${Math.round(Number(y) * 10) / 10} ${String(h.yield_unit ?? '').replace('_per_ac', '/ac')}`.trim(),
          from: 'history',
        })
      }
      // A split field's areas, before its plan's single crop.
      const zoneBy = new Map<string, { names: Set<string>; acres: number }>()
      for (const z of (zones.data ?? []) as Record<string, unknown>[]) {
        const k = `${z.field_id}|${z.crop_year}`
        const e = zoneBy.get(k) ?? { names: new Set<string>(), acres: 0 }
        const n = cropName(byId.get(String(z.crop_id)))
        if (n) e.names.add(n)
        e.acres += Number(z.acres) || 0
        zoneBy.set(k, e)
      }
      for (const [k, e] of zoneBy) {
        const [fieldId, year] = k.split('|')
        if (e.names.size) {
          const crop = [...e.names].join(' + ')
          put({ fieldId, year: Number(year), crop, display: crop, canola: null, record: null, variety: null, acres: e.acres || null, yield: null, from: 'plan' })
        }
      }
      for (const p of (plans.data ?? []) as Record<string, unknown>[]) {
        const name = cropName(byId.get(String(p.crop_id)))
        if (!name) continue
        const canola = canolaOf(p.crop_id, p.variety, p.herbicide_trait)
        put({
          fieldId: String(p.field_id),
          year: Number(p.crop_year),
          crop: name,
          display: shown(name, canola),
          canola,
          record: { table: 'crop_plans', id: String(p.id), trait: (p.herbicide_trait as string) ?? null },
          variety: (p.variety as string) ?? null,
          acres: p.planned_acres == null ? null : Number(p.planned_acres),
          yield: null,
          from: 'plan',
        })
      }
      return out
    },
  })
}

export type IsolationReport = { id: string; field_id: string; crop_year: number; distance_m: number; company: string | null; notes: string | null; updated_at: string }

export function useIsolationReport(fieldId: string | null, year: number) {
  return useQuery({
    queryKey: ['canola-isolation-report', fieldId, year],
    enabled: Boolean(fieldId),
    queryFn: async () => {
      const { data, error } = await db.from('canola_isolation_reports').select('*').eq('field_id', fieldId!).eq('crop_year', year).maybeSingle()
      if (error) throw error
      return (data as IsolationReport | null) ?? null
    },
  })
}

export function useSaveIsolationReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (r: { field_id: string; crop_year: number; company: string | null; notes: string | null }) => {
      const { error } = await db
        .from('canola_isolation_reports')
        .upsert({ ...r, company: r.company?.trim() || null, notes: r.notes?.trim() || null, updated_at: new Date().toISOString() }, { onConflict: 'field_id,crop_year' })
      if (error) throw error
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['canola-isolation-report', v.field_id, v.crop_year] }),
  })
}

/** Set a canola year's herbicide trait on its record (null = not recorded). */
export function useSetYearTrait() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ table, id, trait }: { table: 'crop_history' | 'crop_plans'; id: string; trait: 'liberty' | 'roundup' | null }) => {
      const { error } = await db.from(table).update({ herbicide_trait: trait }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['field-years'] }),
  })
}
