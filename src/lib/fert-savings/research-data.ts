import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import type { Json } from '../database.types'

/**
 * Data for the research-report tools (#29–#36). Each query reads only what its
 * card needs, so a card nobody opens costs nothing beyond its first render.
 */

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** Topsoil EC by site from each field's newest soil test up to the crop year. */
export function useSoilEc(cropYear: number) {
  return useQuery({
    queryKey: ['fert_research', 'ec', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('soil_test_reports')
        .select('id, field_id, crop_year, soil_test_samples(sample_code, depth_top_in, ec_ms_cm)')
        .lte('crop_year', cropYear)
        .order('crop_year', { ascending: false })
      if (error) throw error
      const out = new Map<string, { year: number; sites: { code: string; ec: number }[] }>()
      for (const r of data ?? []) {
        const row = r as unknown as { field_id: string; crop_year: number; soil_test_samples: { sample_code: string; depth_top_in: number | null; ec_ms_cm: number | null }[] }
        if (out.has(row.field_id)) continue
        const sites = row.soil_test_samples
          .filter((s) => Number(s.depth_top_in) === 0 && s.ec_ms_cm != null)
          .map((s) => ({ code: s.sample_code, ec: Number(s.ec_ms_cm) }))
        if (sites.length) out.set(row.field_id, { year: row.crop_year, sites })
      }
      return out
    },
    staleTime: 10 * 60_000,
  })
}

export type FallTest = {
  fieldId: string
  reportDate: string
  residualN: number | null
  drainageMm: number
  fallIrrigationMm: number
  winterPrecipMm: number | null
}

/**
 * Soil tests taken in the fall for this crop year, and what the water did
 * after: drainage past the root zone (the balance's over-irrigation and lost
 * rain), irrigation after the sample, and precipitation over the winter.
 */
export function useFallTests(cropYear: number) {
  return useQuery({
    queryKey: ['fert_research', 'fall', cropYear],
    queryFn: async (): Promise<FallTest[]> => {
      const { data: reports, error } = await supabase
        .from('soil_test_reports')
        .select('id, field_id, crop_year, report_date, soil_test_samples(sample_code, no3n_lb_ac)')
        .eq('crop_year', cropYear)
        .not('report_date', 'is', null)
      if (error) throw error
      const fall = (reports ?? []).filter((r) => {
        const d = r.report_date as string
        return d < `${cropYear}-03-01`
      })
      if (!fall.length) return []
      const from = fall.map((r) => r.report_date as string).sort()[0]
      const springCut = `${cropYear}-04-01`
      const [bal, irr, wx] = await Promise.all([
        supabase
          .from('water_balance_daily')
          .select('field_id, date, over_irrigation_mm, lost_precip_mm')
          .gte('date', from)
          .lt('date', springCut)
          .eq('is_forecast', false),
        supabase.from('irrigation_events').select('field_id, date, net_mm, gross_mm').gte('date', from).lt('date', springCut),
        supabase.from('weather_daily').select('station_id, date, precip_mm').gte('date', `${cropYear - 1}-11-01`).lt('date', springCut),
      ])
      // Winter precipitation from whichever station has the fullest record.
      const byStation = new Map<string, { n: number; sum: number }>()
      for (const w of wx.data ?? []) {
        const k = String(w.station_id)
        const cur = byStation.get(k) ?? { n: 0, sum: 0 }
        if (w.precip_mm != null) {
          cur.n++
          cur.sum += Number(w.precip_mm)
        }
        byStation.set(k, cur)
      }
      const best = [...byStation.values()].sort((a, b) => b.n - a.n)[0]
      const winter = best && best.n > 60 ? best.sum : null

      return fall.map((r) => {
        const row = r as unknown as { field_id: string; report_date: string; soil_test_samples: { sample_code: string; no3n_lb_ac: number | null }[] }
        const bySite = new Map<string, number>()
        for (const s of row.soil_test_samples) {
          if (s.no3n_lb_ac == null) continue
          const site = s.sample_code.replace(/[A-Za-z]+$/, '')
          bySite.set(site, (bySite.get(site) ?? 0) + Number(s.no3n_lb_ac))
        }
        const after = (d: string) => d >= row.report_date
        const drainage = (bal.data ?? [])
          .filter((b) => b.field_id === row.field_id && after(b.date as string))
          .reduce((a, b) => a + Number(b.over_irrigation_mm ?? 0) + Number(b.lost_precip_mm ?? 0), 0)
        const fallIrr = (irr.data ?? [])
          .filter((e) => e.field_id === row.field_id && after(e.date as string))
          .reduce((a, e) => a + Number(e.net_mm ?? e.gross_mm ?? 0), 0)
        return {
          fieldId: row.field_id,
          reportDate: row.report_date,
          residualN: mean([...bySite.values()]),
          drainageMm: drainage,
          fallIrrigationMm: fallIrr,
          winterPrecipMm: winter,
        }
      })
    },
    staleTime: 10 * 60_000,
  })
}

/* ------------------------------------------------------------ N-rich strips */

export function useNStrips(cropYear: number) {
  return useQuery({
    queryKey: ['fert_research', 'strips', cropYear],
    queryFn: async () => {
      const [strips, si] = await Promise.all([
        supabase.from('n_rich_strip_list').select('*').eq('crop_year', cropYear),
        supabase.from('n_strip_sufficiency').select('*').eq('crop_year', cropYear).order('sensed_on', { ascending: false }),
      ])
      if (strips.error) throw strips.error
      if (si.error) throw si.error
      return { strips: strips.data ?? [], readings: si.data ?? [] }
    },
    staleTime: 5 * 60_000,
  })
}

export function useNStripMutations(cropYear: number) {
  const qc = useQueryClient()
  const done = () => void qc.invalidateQueries({ queryKey: ['fert_research', 'strips', cropYear] })
  const create = useMutation({
    mutationFn: async (v: { fieldId: string; widthM: number; offsetM: number; extraLb: number }) => {
      const { error } = await supabase.rpc('create_n_rich_strip', {
        p_field: v.fieldId,
        p_year: cropYear,
        p_width_m: v.widthM,
        p_offset_m: v.offsetM,
        p_extra_lb: v.extraLb,
      })
      if (error) throw error
    },
    onSuccess: done,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('n_rich_strips').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: done,
  })
  // The strip's name, extra N and note (Sam, 7 Oct 2026). Where it lies is
  // laid again rather than edited: delete it and lay a new one.
  const update = useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; label: string | null; extra_lb_n: number | null; notes: string | null }) => {
      const { error } = await supabase.from('n_rich_strips').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: done,
  })
  return { create, remove, update }
}

/* ------------------------------------------------------------- N trials */

export function useNTrials(cropYear: number) {
  return useQuery({
    queryKey: ['fert_research', 'trials', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase.from('n_trials').select('*').eq('crop_year', cropYear).order('created_at')
      if (error) throw error
      return data ?? []
    },
    staleTime: 60_000,
  })
}

export function useTrialStrips(trialId: string | null) {
  return useQuery({
    queryKey: ['fert_research', 'trial_strips', trialId],
    enabled: !!trialId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('n_trial_strips', { p_trial: trialId! })
      if (error) throw error
      return (data ?? []) as { strip: number; rep: number; rate: number; geojson: Json; acres: number; heading: number }[]
    },
    staleTime: 5 * 60_000,
  })
}

export function useNTrialMutations(cropYear: number) {
  const qc = useQueryClient()
  const done = () => void qc.invalidateQueries({ queryKey: ['fert_research'] })
  const save = useMutation({
    mutationFn: async (v: {
      id?: string
      field_id: string
      crop_id: string | null
      name: string | null
      rates: number[]
      reps: number
      layout: number[]
      base_rate: number | null
      strip_width_m: number
      seed: number
      status?: 'planned' | 'applied' | 'harvested'
      results?: Json
      yield_unit?: string | null
    }) => {
      const { id, ...row } = v
      const body = { ...row, crop_year: cropYear, updated_at: new Date().toISOString() }
      const { error } = id ? await supabase.from('n_trials').update(body).eq('id', id) : await supabase.from('n_trials').insert(body)
      if (error) throw error
    },
    onSuccess: done,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('n_trials').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: done,
  })
  return { save, remove }
}

/* ----------------------------------------------------------------- protein */

export function useProtein(cropYear: number) {
  return useQuery({
    queryKey: ['fert_research', 'protein', cropYear],
    queryFn: async () => {
      const [loads, tickets] = await Promise.all([
        supabase.from('bin_loads').select('field_id, crop_id, protein_pct, net_kg').eq('crop_year', cropYear).not('protein_pct', 'is', null),
        supabase.from('scale_tickets').select('crop_id, protein_pct, net_lb, bin_load_id').eq('crop_year', cropYear).not('protein_pct', 'is', null),
      ])
      if (loads.error) throw loads.error
      if (tickets.error) throw tickets.error
      return { loads: loads.data ?? [], tickets: tickets.data ?? [] }
    },
    staleTime: 5 * 60_000,
  })
}

/* ------------------------------------------------------- P and K balance */

/**
 * Everything the running balance needs across years: every fertilizer pass
 * Deere recorded, every soil test's topsoil P and K, every manure spread.
 */
export function usePkHistory() {
  return useQuery({
    queryKey: ['fert_research', 'pk'],
    queryFn: async () => {
      const [ops, reports] = await Promise.all([
        // Application passes only, and only the columns the balance reads — the
        // raw Deere payload on every operation made this the heaviest query on
        // the Savings tab. A season counts only when a pass carried nutrients
        // (see PkBalanceCard), so seeding and harvest passes are not needed.
        supabase
          .from('jd_field_operations')
          .select('id, field_id, crop_season, operation_type, started_at, products')
      .or('not_ours.is.null,not_ours.eq.rented_out')
          .eq('operation_type', 'application'),
        supabase.from('soil_test_reports').select('field_id, crop_year, report_date, soil_test_samples(depth_top_in, p_bicarb_ppm, k_ppm)'),
      ])
      if (ops.error) throw ops.error
      if (reports.error) throw reports.error
      const tests = (reports.data ?? []).map((r) => {
        const row = r as unknown as { field_id: string; crop_year: number; report_date: string | null; soil_test_samples: { depth_top_in: number | null; p_bicarb_ppm: number | null; k_ppm: number | null }[] }
        const top = row.soil_test_samples.filter((s) => Number(s.depth_top_in) === 0)
        return {
          fieldId: row.field_id,
          year: row.crop_year,
          date: row.report_date,
          olsen: mean(top.map((s) => s.p_bicarb_ppm).filter((x): x is number => x != null).map(Number)),
          k: mean(top.map((s) => s.k_ppm).filter((x): x is number => x != null).map(Number)),
        }
      })
      return { ops: ops.data ?? [], tests }
    },
    staleTime: 10 * 60_000,
  })
}
