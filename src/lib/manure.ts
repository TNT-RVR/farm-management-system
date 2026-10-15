import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MultiPolygon } from 'geojson'
import { supabase } from './supabase'
import type { Json } from './database.types'
import type { ManureApplication } from './manure-credit'

/**
 * Reading and writing manure records.
 *
 * The arithmetic lives in manure-credit.ts and is re-exported here, so a screen
 * has one import and the Netlify function that needs only the arithmetic does
 * not drag the Supabase client in behind it.
 */
export * from './manure-credit'

export function useManureApplications(cropYear?: number) {
  return useQuery({
    queryKey: ['manure', cropYear ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('manure_applications').select('*')
      if (cropYear != null) q = q.eq('crop_year', cropYear)
      const { data, error } = await q.order('applied_on', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as ManureApplication[]
    },
  })
}

export type ManureInput = {
  id?: string
  field_id?: string | null
  crop_year: number
  applied_on?: string | null
  source?: string
  rate_tons_per_acre?: number | null
  n_lb_ton?: number | null
  p2o5_lb_ton?: number | null
  k2o_lb_ton?: number | null
  incorporated?: boolean | null
  incorporated_days?: number | null
  manure_type?: 'fresh_pen' | 'stockpiled' | 'straw_bedded' | 'composted' | null
  geojson?: MultiPolygon
  acres?: number | null
  notes?: string | null
}

export function useSaveManure() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (row: ManureInput) => {
      const { id, geojson, ...rest } = row
      const geo = geojson ? { geojson: geojson as unknown as Json } : {}
      const { error } = id
        ? await supabase
            .from('manure_applications')
            .update({ ...rest, ...geo, updated_at: new Date().toISOString() })
            .eq('id', id)
        : await supabase
            .from('manure_applications')
            .insert({ ...rest, ...geo, geojson: geojson as unknown as Json })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['manure'] }),
  })
}

export function useDeleteManure() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('manure_applications').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['manure'] }),
  })
}

/**
 * What the ranking needs to know about each field, in one query.
 *
 * The topsoil averages come from that field's most recent soil test — most
 * recent, not this year's, because a field tested in 2024 and not since is
 * still better judged on 2024's numbers than on nothing at all. The year comes
 * back with them so the screen can say how old they are.
 */
export function useFieldSoilSummary() {
  return useQuery({
    queryKey: ['manure', 'field-soil'],
    queryFn: async () => {
      const [reports, samples, units] = await Promise.all([
        supabase.from('soil_test_reports').select('id, field_id, crop_year'),
        supabase
          .from('soil_test_samples')
          .select('report_id, sample_code, depth_top_in, depth_bottom_in, om_pct, p_bicarb_ppm, k_ppm, no3n_lb_ac, ec_ms_cm'),
        // The survey, for the fields we have never sampled. It is the fallback
        // and never the winner — see soil-priority.ts.
        supabase.from('field_soil_units').select('field_id, detail, pct_of_field'),
      ])
      if (reports.error) throw reports.error
      if (samples.error) throw samples.error
      if (units.error) throw units.error

      // One report per field: the newest. Older ones are not blended in — two
      // tests three years apart average to a number that describes neither.
      const newest = new Map<string, { id: string; year: number }>()
      for (const r of reports.data ?? []) {
        const row = r as { id: string; field_id: string | null; crop_year: number }
        if (!row.field_id) continue
        const have = newest.get(row.field_id)
        if (!have || row.crop_year > have.year) {
          newest.set(row.field_id, { id: row.id, year: row.crop_year })
        }
      }

      type Acc = { om: number[]; p: number[]; k: number[]; ec: number[]; no3: Map<string, number> }
      const empty = (): Acc => ({ om: [], p: [], k: [], ec: [], no3: new Map() })
      const byReport = new Map<string, Acc>()
      for (const s of samples.data ?? []) {
        const row = s as {
          report_id: string
          sample_code?: string | null
          depth_top_in: number | string | null
          depth_bottom_in?: number | string | null
          om_pct: number | string | null
          p_bicarb_ppm: number | string | null
          k_ppm: number | string | null
          no3n_lb_ac?: number | string | null
          ec_ms_cm?: number | string | null
        }
        const acc = byReport.get(row.report_id) ?? empty()
        byReport.set(row.report_id, acc)
        // Nitrate is an amount down the profile: every layer to 24 in adds up
        // per site, for the AOPA check (0–60 cm).
        if (row.no3n_lb_ac != null && Number(row.depth_top_in ?? 0) < 24) {
          // '1A' and '1B' are site 1 at two depths.
          const site = (row.sample_code ?? 'site').replace(/[A-Za-z]+$/, '')
          acc.no3.set(site, (acc.no3.get(site) ?? 0) + Number(row.no3n_lb_ac))
        }
        // Topsoil only. Organic matter, phosphorus and potassium all sit in the
        // top few inches, and folding the subsoil core in halves every reading.
        if (Number(row.depth_top_in) !== 0) continue
        if (row.om_pct != null) acc.om.push(Number(row.om_pct))
        if (row.p_bicarb_ppm != null) acc.p.push(Number(row.p_bicarb_ppm))
        if (row.k_ppm != null) acc.k.push(Number(row.k_ppm))
        if (row.ec_ms_cm != null) acc.ec.push(Number(row.ec_ms_cm))
      }

      // Organic CARBON from the survey's dominant unit, top horizon. Converted
      // to organic matter where it is used; kept raw here so the conversion
      // lives in one place.
      const surveyOc = new Map<string, { oc: number; share: number }>()
      for (const u of units.data ?? []) {
        const row = u as unknown as {
          field_id: string
          pct_of_field: number | string | null
          detail: { horizons?: { top?: number | null; organicCarbon?: number | null }[] }
        }
        const top = (row.detail?.horizons ?? [])
          .filter((h) => h.organicCarbon != null)
          .sort((a, b) => (a.top ?? 0) - (b.top ?? 0))[0]
        if (!top?.organicCarbon) continue
        const share = Number(row.pct_of_field ?? 0)
        const have = surveyOc.get(row.field_id)
        if (!have || share > have.share) surveyOc.set(row.field_id, { oc: top.organicCarbon, share })
      }

      const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null)
      const out = new Map<
        string,
        {
          omPct: number | null
          olsenPPpm: number | null
          kPpm: number | null
          no3nLbAc: number | null
          ecMsCm: number | null
          testYear: number | null
          surveyOrganicCarbonPct: number | null
        }
      >()
      const fieldIds = new Set<string>([...newest.keys(), ...surveyOc.keys()])
      for (const fieldId of fieldIds) {
        const report = newest.get(fieldId)
        const acc = (report ? byReport.get(report.id) : null) ?? empty()
        out.set(fieldId, {
          omPct: mean(acc.om),
          olsenPPpm: mean(acc.p),
          kPpm: mean(acc.k),
          no3nLbAc: mean([...acc.no3.values()]),
          ecMsCm: mean(acc.ec),
          testYear: report?.year ?? null,
          surveyOrganicCarbonPct: surveyOc.get(fieldId)?.oc ?? null,
        })
      }
      return out
    },
  })
}
