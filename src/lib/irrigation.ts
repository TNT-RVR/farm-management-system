import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import { fieldCapacityAtDepth, type SoilLayer } from './et'

export type CropCoefRow = Database['public']['Tables']['crop_coefficients']['Row']
export type FieldSeasonRow = Database['public']['Tables']['field_crop_seasons']['Row']
export type IrrigationEventRow = Database['public']['Tables']['irrigation_events']['Row']
export type WaterBalanceRow = Database['public']['Tables']['water_balance_daily']['Row']
export type StationRow = Database['public']['Tables']['weather_stations']['Row']
export type PumpRow = Database['public']['Tables']['pumps']['Row']
export type WaterLicenceRow = Database['public']['Tables']['water_licences']['Row']
export type FieldPivotRow = Database['public']['Tables']['field_pivots']['Row']
export type SoilProfileRow = Database['public']['Tables']['field_soil_profiles']['Row']

/** Field Capacity + irrigation threshold (mm) over the maximum root zone. */
export function soilCapacities(p: SoilProfileRow | null | undefined) {
  if (!p) return null
  const layers = (Array.isArray(p.layers) ? p.layers : []) as unknown as SoilLayer[]
  const maxCm = Number(p.max_root_zone_depth_m) * 100
  const fc100 = fieldCapacityAtDepth(layers, maxCm)
  const keep = 1 - Number(p.allowable_depletion_pct) / 100
  return {
    fc100,
    threshold100: fc100 == null ? null : fc100 * keep,
  }
}

export const STATUS_LABEL: Record<string, string> = {
  ok: 'OK',
  soon: 'Irrigate soon',
  now: 'Irrigate now',
  stress: 'Water stress',
}
export const STATUS_COLOR: Record<string, string> = {
  ok: 'bg-green-100 text-green-800',
  soon: 'bg-amber-100 text-amber-800',
  now: 'bg-red-100 text-red-800',
  stress: 'bg-red-200 text-red-900',
}

export function useCropCoefficients() {
  return useQuery({
    queryKey: ['crop_coefficients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crop_coefficients')
        .select('*')
        .order('crop')
      if (error) throw error
      return data
    },
  })
}

export function useStations() {
  return useQuery({
    queryKey: ['weather_stations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('weather_stations').select('*').order('name')
      if (error) throw error
      return data
    },
  })
}

export function useFieldSeasons(cropYear: number) {
  return useQuery({
    queryKey: ['field_crop_seasons', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('field_crop_seasons')
        .select('*')
        .eq('crop_year', cropYear)
      if (error) throw error
      return data
    },
  })
}

/**
 * Latest ACTUAL water-balance row per field (the advisory dashboard state).
 * Forecast rows are excluded on purpose: "irrigate now" must describe the soil
 * today, not a projection.
 */
export function useLatestBalance() {
  return useQuery({
    queryKey: ['water_balance_latest'],
    queryFn: async () => {
      // Local dates: after 6 pm here the UTC date is already tomorrow's.
      const since = new Date(Date.now() - 30 * 86_400_000).toLocaleDateString('en-CA')
      const today = new Date().toLocaleDateString('en-CA')
      const { data, error } = await supabase
        .from('water_balance_daily')
        .select('*')
        .gte('date', since)
        .lte('date', today)
        .eq('is_forecast', false)
        .order('date', { ascending: false })
      if (error) throw error
      const latest = new Map<string, WaterBalanceRow>()
      for (const r of data) if (!latest.has(r.field_id)) latest.set(r.field_id, r)
      return [...latest.values()]
    },
  })
}

export type SeasonTotals = {
  /** Crop water use, mm, actual days only. */
  etcMm: number
  /** Rain the model counted, mm. */
  rainMm: number
  /** Irrigation that reached the root zone, mm (after efficiency). */
  irrigationNetMm: number
  days: number
}

/**
 * Season totals per field from the balance: crop water use, rain and the
 * irrigation that counted, actual days only. Read in pages — a farm's season
 * is several thousand rows and PostgREST stops at 1000 — and a field split
 * into crop zones is averaged across its zones day by day, not added up.
 * (Until 1 Oct 2026 the season ETc read one unpaged request, so most fields
 * showed only their first weeks, and zoned fields counted each zone.)
 */
export function useSeasonTotals(cropYear: number) {
  return useQuery({
    queryKey: ['water_balance_season_totals', cropYear],
    queryFn: async () => {
      type R = { field_id: string; zone_id: string | null; date: string; etc_mm: number | null; rainfall_mm: number | null; effective_irrigation_mm: number | null }
      const rows: R[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('water_balance_daily')
          .select('field_id, zone_id, date, etc_mm, rainfall_mm, effective_irrigation_mm')
          .gte('date', `${cropYear}-01-01`)
          .lte('date', `${cropYear}-12-31`)
          .eq('is_forecast', false) // water actually used, not projected
          .order('field_id')
          .order('date')
          .order('zone_id', { nullsFirst: true })
          .range(from, from + 999)
        if (error) throw error
        rows.push(...(data as R[]))
        if (data.length < 1000) break
      }
      // field → date → the day's rows (one, or one per zone)
      const byDay = new Map<string, Map<string, R[]>>()
      for (const r of rows) {
        const f = byDay.get(r.field_id) ?? new Map<string, R[]>()
        f.set(r.date, [...(f.get(r.date) ?? []), r])
        byDay.set(r.field_id, f)
      }
      const totals = new Map<string, SeasonTotals>()
      const avg = (rs: R[], k: 'etc_mm' | 'rainfall_mm' | 'effective_irrigation_mm') => {
        // A whole-field row, when there is one, is the field; otherwise the zones' mean.
        const whole = rs.find((r) => r.zone_id == null)
        const use = whole ? [whole] : rs
        return use.reduce((a, r) => a + Number(r[k] ?? 0), 0) / use.length
      }
      for (const [field, days] of byDay) {
        const t: SeasonTotals = { etcMm: 0, rainMm: 0, irrigationNetMm: 0, days: 0 }
        for (const rs of days.values()) {
          t.etcMm += avg(rs, 'etc_mm')
          t.rainMm += avg(rs, 'rainfall_mm')
          t.irrigationNetMm += avg(rs, 'effective_irrigation_mm')
          t.days++
        }
        totals.set(field, t)
      }
      return totals
    },
  })
}

/** Cumulative season ETc per field (spec §12.1), from useSeasonTotals. */
export function useSeasonEtTotals(cropYear: number) {
  const q = useSeasonTotals(cropYear)
  return { ...q, data: q.data ? new Map([...q.data].map(([k, v]) => [k, v.etcMm])) : undefined }
}

/**
 * Per field, the first forecast day the balance reaches the irrigate trigger —
 * "if you apply nothing, this is when it needs water". Null-safe: a field with
 * no crossing inside the forecast horizon simply isn't in the map.
 */
export function useForecastCrossings() {
  return useQuery({
    queryKey: ['water_balance_forecast_crossing'],
    queryFn: async () => {
      const today = new Date().toLocaleDateString('en-CA')
      const { data, error } = await supabase
        .from('water_balance_daily')
        .select('field_id, date, status, dr_mm, rec_gross_mm')
        .eq('is_forecast', true)
        .gt('date', today)
        .in('status', ['now', 'stress'])
        .order('date')
      if (error) throw error
      const first = new Map<string, { date: string; recGross: number | null }>()
      for (const r of data) {
        if (!first.has(r.field_id)) {
          first.set(r.field_id, { date: r.date, recGross: r.rec_gross_mm })
        }
      }
      return first
    },
  })
}

export function useFieldBalanceSeries(fieldId: string | undefined) {
  return useQuery({
    queryKey: ['water_balance_series', fieldId],
    enabled: Boolean(fieldId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('water_balance_daily')
        .select('*')
        .eq('field_id', fieldId!)
        // Zoned fields have one row per zone per day. Ordering by zone first
        // keeps each zone's series contiguous rather than interleaving them.
        .order('zone_id', { nullsFirst: true })
        .order('date')
      if (error) throw error
      return data
    },
  })
}

/**
 * Mark a field finished watering for the season, or put it back in.
 *
 * The model cannot know the pivot has been shut off and drained, so it keeps
 * crossing the trigger and keeps raising a to-do. This is the person telling
 * it. A database trigger retires the standing task the moment this lands —
 * waiting for the next sync would leave the task the person is looking at
 * sitting there, which reads as the tick not having worked.
 */
export function useSetIrrigationDone(cropYear: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { seasonId: string; done: boolean; userId: string | null }) => {
      const { error } = await supabase
        .from('field_crop_seasons')
        .update({
          irrigation_done_at: v.done ? new Date().toISOString() : null,
          irrigation_done_by: v.done ? v.userId : null,
        })
        .eq('id', v.seasonId)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['field_crop_seasons', cropYear] })
      // The to-do list and the meeting agenda both change on the same tick.
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useSeasonMutations(cropYear: number) {
  const queryClient = useQueryClient()
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['field_crop_seasons', cropYear] })
  const upsert = useMutation({
    mutationFn: async (s: Database['public']['Tables']['field_crop_seasons']['Insert']) => {
      const { error } = await supabase
        .from('field_crop_seasons')
        // Must match field_crop_seasons_zone_key exactly. The old
        // (field_id, crop_year) constraint was dropped when zones landed, and
        // PostgREST cannot infer an index that no longer exists.
        .upsert(s, { onConflict: 'field_id,zone_id,crop_year' })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('field_crop_seasons').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { upsert, remove }
}

/**
 * Per-field soil calibration (spec §8, phase 5). Soil test data is the primary
 * source for TAW; the texture default is only the backup. Setting FC/WP
 * directly overrides the texture lookup in the pipeline.
 */
export function useSetFieldSoil() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      soil_texture,
      soil_fc,
      soil_wp,
      soil_source,
    }: {
      id: string
      soil_texture?: string | null
      soil_fc?: number | null
      soil_wp?: number | null
      /** 'manual' once a person has set the figures; the import skips those. */
      soil_source?: 'survey' | 'manual' | null
    }) => {
      const patch: Database['public']['Tables']['fields']['Update'] = {}
      if (soil_texture !== undefined) patch.soil_texture = soil_texture
      if (soil_fc !== undefined) patch.soil_fc = soil_fc
      if (soil_wp !== undefined) patch.soil_wp = soil_wp
      if (soil_source !== undefined) patch.soil_source = soil_source
      const { error } = await supabase.from('fields').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['fields'] }),
  })
}

export function useLogIrrigation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (e: Database['public']['Tables']['irrigation_events']['Insert']) => {
      const { data: auth } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('irrigation_events')
        .insert({ ...e, created_by: auth.user!.id })
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['irrigation_events'] }),
  })
}

export type AimmWatchRow = Database['public']['Tables']['aimm_watch']['Row']

export function farmQuery() {
  return {
    queryKey: ['farm'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('farms')
        .select('id, kc_mode, weather_source, river_station_number, river_station_name, river_alert_cms')
        .limit(1)
        .single()
      if (error) throw error
      return data
    },
  }
}

export function useFarm() {
  return useQuery(farmQuery())
}

export type RiverFlow = {
  station: string
  name: string | null
  discharge: number | null
  level: number | null
  datetime: string | null
}

/** Live Oldman River flow via the river-flow proxy (refreshes every 5 min). */
export function useRiverFlow(station: string | null | undefined) {
  return useQuery({
    queryKey: ['river_flow', station],
    enabled: Boolean(station),
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<RiverFlow> => {
      const res = await fetch(`/api/river-flow?station=${encodeURIComponent(station!)}`)
      if (!res.ok) throw new Error('River data unavailable')
      return res.json()
    },
  })
}

export type RiverPoint = { t: string; discharge: number | null; level: number | null }

/** River discharge/level time series over [from,to] (daily-mean for long spans). */
export function useRiverSeries(
  station: string | null | undefined,
  from: string,
  to: string,
  daily: boolean,
) {
  return useQuery({
    queryKey: ['river_series', station, from, to, daily],
    enabled: Boolean(station && from && to),
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<{ station: string; name: string | null; daily: boolean; series: RiverPoint[] }> => {
      const res = await fetch(
        `/api/river-flow?station=${encodeURIComponent(station!)}` +
          `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${daily ? '&daily=1' : ''}`,
      )
      if (!res.ok) throw new Error('River data unavailable')
      return res.json()
    },
  })
}

export function useSetFarmRiverAlert() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, river_alert_cms }: { id: string; river_alert_cms: number | null }) => {
      const { error } = await supabase.from('farms').update({ river_alert_cms }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['farm'] }),
  })
}

export function useSetFarmWeatherSource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, weather_source }: { id: string; weather_source: string }) => {
      const { error } = await supabase.from('farms').update({ weather_source }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['farm'] }),
  })
}

export function useSetFarmKcMode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, kc_mode }: { id: string; kc_mode: string }) => {
      const { error } = await supabase.from('farms').update({ kc_mode }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['farm'] }),
  })
}

export function useAimmWatch() {
  return useQuery({
    queryKey: ['aimm_watch'],
    queryFn: async () => {
      const { data, error } = await supabase.from('aimm_watch').select('*').order('label')
      if (error) throw error
      return data
    },
  })
}

export function useRunAimmWatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/aimm-watch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Check failed')
      return body as { checked: number; changed: string[] }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['aimm_watch'] }),
  })
}

export function usePumps() {
  return useQuery({
    queryKey: ['pumps'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pumps').select('*').order('name')
      if (error) throw error
      return data
    },
  })
}

export function useWaterLicences() {
  return useQuery({
    queryKey: ['water_licences'],
    queryFn: async () => {
      const { data, error } = await supabase.from('water_licences').select('*').order('licence_number')
      if (error) throw error
      return data
    },
  })
}

export function fieldPivotsQuery() {
  return {
    queryKey: ['field_pivots'],
    queryFn: async () => {
      const { data, error } = await supabase.from('field_pivots').select('*')
      if (error) throw error
      return data
    },
  }
}

/** The irrigation district's rate for a year, from water_allotments (smrid-rates-cron keeps it current). */
export type DistrictRate = { year: number; ratePerAcre: number; minPerParcel: number | null; note: string | null }

export function useDistrictRate(year: number) {
  return useQuery({
    queryKey: ['district_rate', year],
    queryFn: async (): Promise<DistrictRate | null> => {
      const { data, error } = await supabase
        .from('water_allotments')
        .select('year, rate_per_acre, min_per_parcel, rate_note')
        .eq('source', 'smrid')
        .eq('year', year)
        .maybeSingle()
      if (error) throw error
      if (data?.rate_per_acre == null) return null
      return { year, ratePerAcre: Number(data.rate_per_acre), minPerParcel: data.min_per_parcel == null ? null : Number(data.min_per_parcel), note: data.rate_note }
    },
  })
}

export function useFieldPivots() {
  return useQuery(fieldPivotsQuery())
}

export function useSetFieldPivot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (p: Database['public']['Tables']['field_pivots']['Insert']) => {
      const { error } = await supabase.from('field_pivots').upsert(p, { onConflict: 'field_id' })
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['field_pivots'] }),
  })
}

export function useDeleteFieldPivot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('field_pivots').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['field_pivots'] }),
  })
}

export function useSetPump() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Database['public']['Tables']['pumps']['Update']
    }) => {
      const { error } = await supabase.from('pumps').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['pumps'] }),
  })
}

export function useSetWaterLicence() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Database['public']['Tables']['water_licences']['Update']
    }) => {
      const { error } = await supabase.from('water_licences').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['water_licences'] }),
  })
}

/** SMRID water coordinators by district area (refreshed each April). */
export function useSmridAreas() {
  return useQuery({
    queryKey: ['smrid_areas'],
    queryFn: async () => {
      const { data, error } = await supabase.from('smrid_areas').select('*').order('area_number')
      if (error) throw error
      return data
    },
  })
}

/** Manager-only: re-check the SMRID staff directory now. */
export function useCheckSmridStaff() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/smrid-staff-check', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string }
      if (!res.ok) throw new Error(body.error ?? body.detail ?? 'Check failed')
      return body as { ok: boolean; parsed: number; detail: string }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['smrid_areas'] }),
  })
}

/** Create a pump. `name` is NOT NULL, so an unnamed one gets a placeholder. */
export function useCreatePump() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Database['public']['Tables']['pumps']['Insert']) => {
      const { error } = await supabase
        .from('pumps')
        .insert({ ...patch, name: patch.name?.trim() || 'New pump' })
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['pumps'] }),
  })
}

/**
 * Create a water licence. farm_id is nullable but every existing row has it set,
 * so new ones are attached to the farm too rather than becoming orphans.
 */
export function useCreateWaterLicence() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Database['public']['Tables']['water_licences']['Insert']) => {
      const { data: farm } = await supabase.from('farms').select('id').limit(1).single()
      const { error } = await supabase
        .from('water_licences')
        .insert({ ...patch, farm_id: farm?.id ?? null })
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['water_licences'] }),
  })
}

/**
 * Delete a pump (managers; pumps is manager-write). Pivots on it keep their
 * record with no pump, and a pump sharing its meter falls back to none — both
 * ON DELETE SET NULL — so those lists are refreshed too.
 */
export function useDeletePump() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('pumps').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pumps'] })
      void queryClient.invalidateQueries({ queryKey: ['field_pivots'] })
    },
  })
}

/** Delete a water licence (managers). Pivots on it are left with no licence (ON DELETE SET NULL). */
export function useDeleteWaterLicence() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('water_licences').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['water_licences'] })
      void queryClient.invalidateQueries({ queryKey: ['field_pivots'] })
      void queryClient.invalidateQueries({ queryKey: ['water_rights'] })
    },
  })
}

// ---- hand-entered irrigation records: edit and delete (Sam, 7 Oct 2026) ----

type DepthCheckUpdate = Database['public']['Tables']['pivot_depth_checks']['Update']

/** Correct a recorded pivot depth check (managers; pivot_depth_checks is manager-write). */
export function useUpdateDepthCheck() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: DepthCheckUpdate }) => {
      const { error } = await supabase.from('pivot_depth_checks').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['pivot_depth_checks'] }),
  })
}

export function useDeleteDepthCheck() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('pivot_depth_checks').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['pivot_depth_checks'] }),
  })
}

const invalidateIrrigationEvents = (queryClient: ReturnType<typeof useQueryClient>) => {
  void queryClient.invalidateQueries({ queryKey: ['irrigation_events'] })
  void queryClient.invalidateQueries({ queryKey: ['water_allocation'] })
  void queryClient.invalidateQueries({ queryKey: ['water_rights'] })
}

/** Delete a hand-logged pass. The policy lets a manager, or whoever logged it, do this. */
export function useDeleteIrrigationEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      // .select() so a row the policy hid from the delete reads as a refusal,
      // not as a success that quietly left the pass in place.
      const { data, error } = await supabase.from('irrigation_events').delete().eq('id', id).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('Not deleted: only a manager or whoever logged it can remove a pass.')
    },
    onSuccess: () => invalidateIrrigationEvents(queryClient),
  })
}

/**
 * Change the date or amount of a hand-logged pass. Updates to irrigation_events
 * are granted on the correction columns only (20261001120000), so a new date
 * cannot be written in place: the pass is logged again with the new figures and
 * the old one removed — new row first, so a refused delete leaves nothing lost
 * (and the new row is taken back out). Needs the same rights as a delete.
 */
export function useReplaceIrrigationEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      old: { id: string; field_id: string; zone_id: string | null; coverage_deg: number | null }
      date: string
      gross_mm: number
      note: string | null
    }) => {
      const { data: auth } = await supabase.auth.getUser()
      const { data: added, error } = await supabase
        .from('irrigation_events')
        .insert({
          field_id: v.old.field_id,
          zone_id: v.old.zone_id,
          coverage_deg: v.old.coverage_deg,
          date: v.date,
          gross_mm: Math.round(v.gross_mm * 10) / 10,
          note: v.note,
          source: 'manual',
          created_by: auth.user!.id,
        })
        .select('id')
        .single()
      if (error) throw error
      const { data: gone, error: delErr } = await supabase.from('irrigation_events').delete().eq('id', v.old.id).select('id')
      if (delErr || !gone?.length) {
        await supabase.from('irrigation_events').delete().eq('id', added.id)
        throw new Error(delErr?.message ?? 'Not changed: only a manager or whoever logged it can change a pass.')
      }
    },
    onSuccess: () => invalidateIrrigationEvents(queryClient),
  })
}

/** Correct or remove a rain-gauge reading (any active user may; rain_readings_write). */
export function useUpdateRainReading() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Database['public']['Tables']['rain_gauge_readings']['Update'] }) => {
      const { error } = await supabase.from('rain_gauge_readings').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['rain_gauge_readings'] }),
  })
}

export function useDeleteRainReading() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('rain_gauge_readings').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['rain_gauge_readings'] }),
  })
}

/** Every rain gauge, retired ones too, for the list where they are managed. */
export function useAllRainGauges() {
  return useQuery({
    queryKey: ['rain_gauges', 'all'],
    queryFn: async () => {
      const [g, f] = await Promise.all([
        supabase.from('rain_gauges').select('*').order('name'),
        supabase.from('fields').select('id, name, rain_gauge_id').not('rain_gauge_id', 'is', null),
      ])
      if (g.error) throw g.error
      if (f.error) throw f.error
      return { gauges: g.data ?? [], fields: f.data ?? [] }
    },
  })
}

/** Add, rename, retire or delete a rain gauge (managers; rain_gauges_write). */
export function useSaveRainGauge() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id?: string; name: string; active?: boolean }) => {
      const row = { name: v.name.trim(), ...(v.active !== undefined ? { active: v.active } : {}) }
      const { error } = v.id ? await supabase.from('rain_gauges').update(row).eq('id', v.id) : await supabase.from('rain_gauges').insert(row)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['rain_gauges'] }),
  })
}

/** Readings go with the gauge (cascade); fields on it fall back to radar (set null). */
export function useDeleteRainGauge() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('rain_gauges').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rain_gauges'] })
      void queryClient.invalidateQueries({ queryKey: ['field_gauge'] })
      void queryClient.invalidateQueries({ queryKey: ['rain_gauge_readings'] })
    },
  })
}

/** Correct a soil moisture reading (any active user may write them). */
export function useUpdateSoilReading() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Database['public']['Tables']['soil_moisture_readings']['Update'] }) => {
      const { error } = await supabase.from('soil_moisture_readings').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['soil_moisture_readings'] }),
  })
}

export function soilProfilesQuery() {
  return {
    queryKey: ['field_soil_profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('field_soil_profiles').select('*')
      if (error) throw error
      return data
    },
  }
}

export function useSoilProfiles() {
  return useQuery(soilProfilesQuery())
}

export function useSetSoilProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (p: Database['public']['Tables']['field_soil_profiles']['Insert']) => {
      const { error } = await supabase.from('field_soil_profiles').upsert(p, { onConflict: 'field_id' })
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['field_soil_profiles'] }),
  })
}

/**
 * Historical fill of applied irrigation from FieldNET.
 *
 * A Netlify background function, so the POST returns 202 the moment the job is
 * accepted and the work continues server-side for a few minutes. There is no
 * result to await — the caller can only report that it started, and the numbers
 * show up in the balance once it finishes.
 */
export function useIrrigationBackfill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ from, to }: { from: string; to: string }) => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch(`/api/fieldnet-backfill-background?from=${from}&to=${to}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      // 202 = accepted and running. Anything else carries a real error body.
      if (res.status !== 202 && !res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `Backfill failed (${res.status})`)
      }
      return { started: true }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['water_balance_daily'] })
    },
  })
}

export function useIrrigationSync() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/irrigation-sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Sync failed')
      return body as { weatherRows: number; fields: number; balanceRows: number; tasks: number }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['water_balance_latest'] })
      void queryClient.invalidateQueries({ queryKey: ['water_balance_series'] })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}
