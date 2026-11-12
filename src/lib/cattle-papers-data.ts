/**
 * The reads and writes behind the cattle features built on the research
 * library: water tests and arrivals.
 *
 * One file because they are small tables that nothing else touches, and two
 * files of a dozen lines each would be harder to find than this. The
 * thresholds all live elsewhere, beside the paper they came from —
 * livestock-water.ts, brd-risk.ts — and nothing here decides anything.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

type Tables = Database['public']['Tables']

/**
 * A copy without the keys named, for an update payload built from an insert
 * shape: the server-set columns and the owning foreign key must not be sent on
 * an edit, and the client's Update types refuse them outright.
 */
function without<T extends object, K extends keyof T>(row: T, keys: readonly K[]): Omit<T, K> {
  const out: Partial<T> = { ...row }
  for (const k of keys) delete out[k]
  return out as Omit<T, K>
}

export type WaterTestRow = Tables['cattle_water_tests']['Row']
export type ManifestRow = Tables['cattle_manifests']['Row']
export type ManifestLineRow = Tables['cattle_manifest_lines']['Row']

// ── Water tests ───────────────────────────────────────────────────────────

/** Every test on every cattle water source, newest first. */
export function useWaterTests() {
  return useQuery({
    queryKey: ['cattle-water-tests'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cattle_water_tests')
        .select('*')
        .order('sampled_on', { ascending: false })
      if (error) throw error
      return (data ?? []) as WaterTestRow[]
    },
  })
}

/** The newest test for each water source. */
export function latestByWater(rows: WaterTestRow[] | undefined) {
  const out = new Map<string, WaterTestRow>()
  // The query already comes back newest first, so the first one wins.
  for (const r of rows ?? []) if (!out.has(r.water_id)) out.set(r.water_id, r)
  return out
}

export function useWaterTestMutations() {
  const qc = useQueryClient()
  const done = () => void qc.invalidateQueries({ queryKey: ['cattle-water-tests'] })
  return {
    save: useMutation({
      // One call for a new sheet and an edited one. The two payloads are built
      // apart on purpose: an update must not carry water_id or the created_*
      // columns, which the client's own Update type refuses.
      mutationFn: async ({ id, ...row }: Tables['cattle_water_tests']['Insert'] & { id?: string }) => {
        if (id) {
          const patch = without(row, ['water_id', 'created_at', 'created_by'] as const)
          const { error } = await supabase
            .from('cattle_water_tests')
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq('id', id)
          if (error) throw error
          return
        }
        const { error } = await supabase.from('cattle_water_tests').insert(row)
        if (error) throw error
      },
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => {
        const { error } = await supabase.from('cattle_water_tests').delete().eq('id', id)
        if (error) throw error
      },
      onSuccess: done,
    }),
  }
}

// ── Arrivals ──────────────────────────────────────────────────────────────

export type ArrivalWithLines = ManifestRow & { lines: ManifestLineRow[] }

/**
 * Manifests the cattle came in on, newest first, with their lines.
 *
 * Only `direction = 'in'`: every manifest written before arrivals existed is
 * paperwork for cattle leaving, and the column defaults to 'out' so none of
 * them turns up here by accident.
 */
export function useArrivals(cropYear: number) {
  return useQuery({
    queryKey: ['cattle-arrivals', cropYear],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cattle_manifests')
        .select('*')
        .eq('crop_year', cropYear)
        .eq('direction', 'in')
        .order('moved_on', { ascending: false })
      if (error) throw error
      const manifests = (data ?? []) as ManifestRow[]
      if (!manifests.length) return [] as ArrivalWithLines[]
      const { data: lines, error: lineErr } = await supabase
        .from('cattle_manifest_lines')
        .select('*')
        .in('manifest_id', manifests.map((m) => m.id))
        .order('sort_order')
      if (lineErr) throw lineErr
      const byManifest = new Map<string, ManifestLineRow[]>()
      for (const l of (lines ?? []) as ManifestLineRow[]) {
        const list = byManifest.get(l.manifest_id) ?? []
        list.push(l)
        byManifest.set(l.manifest_id, list)
      }
      return manifests.map((m) => ({ ...m, lines: byManifest.get(m.id) ?? [] }))
    },
  })
}

/**
 * The weather on the days cattle arrived, from the nearest station's daily
 * record — the three variables the Alberta entry study recorded at arrival.
 *
 * One query for all the dates asked about rather than one per arrival. Where a
 * date has readings from more than one station they are averaged, because the
 * study recorded "the weather at arrival" and not a particular station's.
 */
export function useArrivalWeather(dates: string[]) {
  const keys = [...new Set(dates.filter(Boolean))].sort()
  return useQuery({
    queryKey: ['arrival-weather', keys.join(',')],
    enabled: keys.length > 0,
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('weather_daily')
        .select('date, tmax_c, tmin_c, precip_mm, wind_ms')
        .in('date', keys)
      if (error) throw error
      const acc = new Map<string, { tmax: number[]; tmin: number[]; precip: number[]; wind: number[] }>()
      for (const r of (data ?? []) as { date: string; tmax_c: number | null; tmin_c: number | null; precip_mm: number | null; wind_ms: number | null }[]) {
        const a = acc.get(r.date) ?? { tmax: [], tmin: [], precip: [], wind: [] }
        if (r.tmax_c != null) a.tmax.push(Number(r.tmax_c))
        if (r.tmin_c != null) a.tmin.push(Number(r.tmin_c))
        if (r.precip_mm != null) a.precip.push(Number(r.precip_mm))
        if (r.wind_ms != null) a.wind.push(Number(r.wind_ms))
        acc.set(r.date, a)
      }
      const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
      const out = new Map<string, { tmaxC: number | null; tminC: number | null; precipMm: number | null; windMs: number | null }>()
      for (const [date, a] of acc) {
        out.set(date, { tmaxC: mean(a.tmax), tminC: mean(a.tmin), precipMm: mean(a.precip), windMs: mean(a.wind) })
      }
      return out
    },
  })
}

export function useArrivalMutations() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Tables['cattle_manifests']['Update'] }) => {
      const { error } = await supabase.from('cattle_manifests').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cattle-arrivals'] })
      void qc.invalidateQueries({ queryKey: ['cattle_manifests'] })
    },
  })
}
