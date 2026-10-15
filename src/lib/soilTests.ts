import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

export type SoilReportRow = Database['public']['Tables']['soil_test_reports']['Row']
export type SoilSampleRow = Database['public']['Tables']['soil_test_samples']['Row']
export type SoilAssessmentRow = Database['public']['Tables']['soil_test_assessments']['Row']

/** A report with its samples, which is how every screen wants it. */
export type SoilReport = SoilReportRow & {
  field_name?: string
  samples: SoilSampleRow[]
  assessment?: SoilAssessmentRow | null
}

/**
 * Every report for a field, newest year first.
 *
 * Samples come back in one query rather than per report — a field has at most a
 * handful of years and each has six to eight samples, so a join is cheaper than
 * a request per year and keeps the history chart from waterfalling.
 */
export function useFieldSoilReports(fieldId: string | null | undefined) {
  return useQuery({
    queryKey: ['soil_test_reports', fieldId],
    enabled: Boolean(fieldId),
    queryFn: async (): Promise<SoilReport[]> => {
      const { data: reports, error } = await supabase
        .from('soil_test_reports')
        .select('*')
        .eq('field_id', fieldId!)
        .order('crop_year', { ascending: false })
        .order('part_label')
      if (error) throw error
      const ids = (reports ?? []).map((r) => r.id)
      if (!ids.length) return []

      const [{ data: samples }, { data: assessments }] = await Promise.all([
        supabase.from('soil_test_samples').select('*').in('report_id', ids).order('sample_code'),
        supabase.from('soil_test_assessments').select('*').in('report_id', ids),
      ])
      const byReport = new Map<string, SoilSampleRow[]>()
      for (const s of samples ?? []) {
        if (!byReport.has(s.report_id)) byReport.set(s.report_id, [])
        byReport.get(s.report_id)!.push(s)
      }
      const assessById = new Map((assessments ?? []).map((a) => [a.report_id, a]))
      return (reports ?? []).map((r) => ({
        ...r,
        samples: byReport.get(r.id) ?? [],
        assessment: assessById.get(r.id) ?? null,
      }))
    },
  })
}

/** Which fields have soil tests, and for which years — drives the field list. */
export function useSoilTestCoverage() {
  return useQuery({
    queryKey: ['soil_test_coverage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('soil_test_reports')
        .select('id, field_id, crop_year, crop_label, lab, report_date')
        .order('crop_year', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

/**
 * The mobile nutrients read across the whole sampled profile.
 *
 * Nitrate and sulphate move with water, so a decision is made on the 0-24 inch
 * total rather than on the topsoil core — a field can read empty at the surface
 * and still be holding a useful amount underneath. Every other nutrient is
 * judged on the topsoil, where it actually sits.
 */
export function profileTotals(samples: SoilSampleRow[]) {
  const bySite = new Map<string, SoilSampleRow[]>()
  for (const s of samples) {
    const site = s.sample_code.replace(/[A-Z]$/, '')
    if (!bySite.has(site)) bySite.set(site, [])
    bySite.get(site)!.push(s)
  }
  const totals: { site: string; no3n_lb_ac: number | null }[] = []
  for (const [site, rows] of bySite) {
    // lb/ac is an AMOUNT over the sampled depth, so the two layers add. This is
    // the figure a nitrogen rate is set from.
    const n = rows.reduce<number | null>(
      (acc, r) => (r.no3n_lb_ac == null ? acc : (acc ?? 0) + Number(r.no3n_lb_ac)),
      null,
    )
    totals.push({ site, no3n_lb_ac: n })
  }
  const avg = (pick: (t: (typeof totals)[number]) => number | null) => {
    const vals = totals.map(pick).filter((v): v is number => v != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }

  // Sulphate is reported only as ppm — a CONCENTRATION, which cannot be added
  // between layers. Summing it produced a number with no meaning (a "0-24 inch
  // sulphate" of 34 ppm was the topsoil and subsoil concentrations added
  // together). Each depth is averaged across sites and reported separately, and
  // the lb/ac conversion is deliberately not attempted: it needs a depth factor
  // and a threshold in lb/ac that this lab does not supply.
  const depthAvg = (topsoil: boolean) => {
    const vals = samples
      .filter((r) => (topsoil ? r.depth_top_in === 0 : r.depth_top_in !== 0))
      .map((r) => r.so4s_ppm)
      .filter((v): v is number => v != null)
    return vals.length ? vals.reduce((a, b) => a + Number(b), 0) / vals.length : null
  }

  return {
    bySite: totals,
    avgNo3nLbAc: avg((t) => t.no3n_lb_ac),
    so4sTopPpm: depthAvg(true),
    so4sSubPpm: depthAvg(false),
  }
}

/** Field average of one column across the topsoil cores. */
export function topsoilAverage(samples: SoilSampleRow[], key: keyof SoilSampleRow) {
  const vals = samples
    .filter((s) => s.depth_top_in === 0)
    .map((s) => s[key])
    .filter((v): v is number => v != null && typeof v === 'number')
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

/** Writes every assessment that is missing or stale, in one background run. */
export function useAssessmentSweep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/soil-assessment-sweep-background', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      if (res.status !== 202 && !res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `Sweep failed (${res.status})`)
      }
      return { started: true }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['soil_test_reports'] })
    },
  })
}

/**
 * What the last sweep actually did.
 *
 * The sweep is a background function, so its HTTP answer is discarded and the
 * browser can never see an error from it. Its outcome is recorded on the
 * integrations board instead, and read back here — otherwise a refused or
 * failed run is indistinguishable from one that never started.
 */
export function useAssessmentSweepStatus() {
  return useQuery({
    queryKey: ['soil_assessment_sweep_status'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('integration_health')
        .select('status, detail, last_success_at')
        .eq('source_key', 'soil_assessments')
        .maybeSingle()
      if (error) throw error
      return data
    },
    // Only while something is outstanding, and only while the page is on
    // screen. It used to poll in the background for as long as the tab stayed
    // open — on phones that left Fertilizer up, forever. Coming back to the
    // tab refetches on focus, so the banner is current the moment it is seen.
    refetchInterval: (q) => (q.state.data?.status === 'ok' ? 60_000 : 10_000),
  })
}

/** How many reports are still waiting for a write-up. */
export function useAssessmentsPending() {
  return useQuery({
    queryKey: ['soil_assessments_pending'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('soil_reports_needing_assessment')
        .select('report_id', { count: 'exact', head: true })
      if (error) throw error
      return count ?? 0
    },
    // Half a second of database time per call (the view rehashes every
    // report's inputs), so: every 15 s only while some are pending, and never
    // from a background tab. It was 6,000+ calls by October.
    refetchInterval: (q) => (q.state.data ? 15_000 : false),
  })
}

export function useGenerateAssessment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (reportId: string) => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/soil-assessment-background', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ report_id: reportId }),
      })
      // 202 = accepted and running server-side; there is no result to await.
      if (res.status !== 202 && !res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `Assessment failed (${res.status})`)
      }
      return { started: true }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['soil_test_reports'] })
    },
  })
}

/** Every query a soil test's numbers feed, refreshed after a test is added, changed or removed. */
export const SOIL_QUERY_ROOTS = new Set([
  'soil_test_reports',
  'soil_test_coverage',
  'soil_assessments_pending',
  'fertilizer_requirements',
  'fert_soil_by_field',
])

function useInvalidateSoil() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ predicate: (q) => SOIL_QUERY_ROOTS.has(String(q.queryKey[0])) })
}

export type SoilReportPatch = Pick<SoilReportRow, 'field_id' | 'crop_year' | 'part_label' | 'crop_label' | 'lab' | 'report_ref' | 'report_date'>

/**
 * Correct a report's header: the lab, the date, which field it is (Sam,
 * 7 Oct 2026). Managers only, by RLS. A field-year-part that already has a
 * report is refused by the unique key, and the message says so.
 */
export function useUpdateSoilReport() {
  const onDone = useInvalidateSoil()
  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, patch }: { id: string; patch: SoilReportPatch }) => {
      const { error } = await supabase
        .from('soil_test_reports')
        .update({ ...patch, part_label: patch.part_label ?? '' })
        .eq('id', id)
      if (error) {
        if (error.code === '23505') throw new Error('That field already has a report for that year and part. Give this one a part label (East Half, say) or delete the other.')
        throw error
      }
    },
    onSuccess: onDone,
  })
}

/** A whole report. Its samples and its written assessment go with it (both cascade). */
export function useDeleteSoilReport() {
  const onDone = useInvalidateSoil()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('soil_test_reports').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: onDone,
  })
}

export function useUpdateSoilSample() {
  const onDone = useInvalidateSoil()
  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, patch }: { id: string; patch: Database['public']['Tables']['soil_test_samples']['Update'] }) => {
      const { error } = await supabase.from('soil_test_samples').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: onDone,
  })
}

export function useDeleteSoilSample() {
  const onDone = useInvalidateSoil()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('soil_test_samples').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: onDone,
  })
}
