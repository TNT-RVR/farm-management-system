/**
 * The seed company forms: the reports kept, and what the app knows to fill them.
 * Company-agnostic: which company's form a report prints on is the form
 * style's business (styles.ts), chosen from the report's company.
 *
 * A report keeps what it prints: the app's values are written into it when it
 * is started (and again on "Fill from the app" for anything still blank), so
 * the form can be reprinted unchanged after the records behind it move. Only
 * the company's field number and codes, its bin labels, moisture and seed
 * temperature are left for a person.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { loadInBin } from '@/lib/bin-loads'
import type { Database } from '@/lib/database.types'
import { companyLookup } from '@/lib/crop-label'
import { contractCompany, type CanolaCrop } from '@/lib/reports/seed-canola'
import { effectiveHarvestDate, farmDay } from '@/lib/harvest-date'
import { finishedDays, finishedFor } from '@/lib/field-work'
import { weatherForField } from '@/lib/work-record-weather'
import { binNumber } from '@/lib/bins'
import { bushelsToKg, fullLegal, growerBinLabel, weatherText, type SeedReportForm } from './format'

export type SeedReport = Database['public']['Tables']['seed_reports']['Row']
export type SeedReportBin = Database['public']['Tables']['seed_report_bins']['Row']

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/* ── Which fields grow the company's seed ──────────────────────────────── */

export type SeedField = { cropId: string; company: string }

/** Fields whose plan this year (the field's own, or a split area's) is contract canola, with the company it is grown for. */
export function useSeedFormFields(year: number) {
  return useQuery({
    queryKey: ['seed_forms', 'fields', year],
    queryFn: async () => {
      const [plans, zones, crops, varieties] = await Promise.all([
        supabase.from('crop_plans').select('field_id, crop_id, variety').eq('crop_year', year),
        // A split area has a crop but no variety: its company is the crop's own.
        supabase.from('field_crop_zones').select('field_id, crop_id').eq('crop_year', year),
        supabase.from('crops').select('id, name, category, herbicide_trait, min_return_years, average_of, yield_unit'),
        supabase.from('crop_varieties').select('crop_id, name, company'),
      ])
      for (const r of [plans, zones, crops, varieties]) if (r.error) throw r.error
      const lookup = companyLookup(varieties.data ?? [])
      const cropById = new Map(((crops.data ?? []) as CanolaCrop[]).map((c) => [c.id, c]))
      const out = new Map<string, SeedField>()
      for (const p of [...(plans.data ?? []), ...(zones.data ?? []).map((z) => ({ ...z, variety: null }))]) {
        const co = contractCompany(cropById.get(p.crop_id), p.variety ?? null, (id, v) => lookup(id, v))
        // The field's own plan first; a split area only adds a field.
        if (co && !out.has(p.field_id)) out.set(p.field_id, { cropId: p.crop_id, company: co })
      }
      return out
    },
    staleTime: 5 * 60_000,
  })
}

/* ── What the app knows ────────────────────────────────────────────────── */

export type BinSuggestion = { bin_id: string; name: string; kg: number | null; from: string }

export type Suggestion = {
  legal: string | null
  gpsAcres: number | null
  totalKg: number | null
  harvestOn: string | null
  harvestFrom: string | null
  weather: string | null
  bins: BinSuggestion[]
}

const HARVEST_FROM: Record<string, string> = {
  finished: 'field marked finished',
  manual: 'harvest date typed in',
  last_load: 'last load from the field',
  john_deere: 'last Deere harvest pass',
  hand: 'harvest entered by hand',
}

/**
 * Everything the app can put on the report for a field and year. Kilograms a
 * bin come from the scale loads into it; failing those, the harvest moved in
 * on the bin map (bushels at the crop's test weight); failing that, the bin
 * plan — said so, as it is an estimate until the loads are in.
 */
export async function suggestSeedReport(fieldId: string, year: number, legalAs: (lld: string | null | undefined) => string | null = fullLegal): Promise<Suggestion> {
  const today = new Date().toLocaleDateString('en-CA')
  const [field, bounds, loads, moves, allocs, finishes, typed, ops, bins, crops] = await Promise.all([
    supabase.from('fields').select('legal_land_description').eq('id', fieldId).maybeSingle(),
    supabase.from('field_boundaries').select('acres, valid_from, valid_to').eq('field_id', fieldId),
    supabase.from('bin_loads').select('bin_id, overflow_bin_id, first_bin_bu, bushels, net_kg, loaded_on, last_from_field').eq('field_id', fieldId).eq('crop_year', year),
    supabase.from('grain_movements').select('bin_id, crop_id, bushels, ticket_number').eq('field_id', fieldId).eq('crop_year', year).eq('movement_type', 'harvest_in'),
    supabase.from('bin_allocations').select('bin_id, crop_id, actual_bu, estimated_bu').eq('field_id', fieldId).eq('crop_year', year),
    supabase.from('field_work_records').select('field_id, zone_id, crop_year, counts_as, started_at, finished_at, field_finished').eq('field_id', fieldId).eq('crop_year', year).eq('counts_as', 'harvest'),
    supabase.from('field_crop_seasons').select('harvest_date').eq('field_id', fieldId).eq('crop_year', year).not('harvest_date', 'is', null),
    supabase
      .from('jd_field_operations')
      .select('started_at, ended_at')
      .eq('field_id', fieldId)
      .eq('crop_season', year)
      .eq('operation_type', 'harvest')
      .is('duplicate_of', null)
      .is('not_ours', null),
    supabase.from('bins').select('id, name'),
    supabase.from('crops').select('id, test_weight_lb_per_bu'),
  ])
  for (const r of [field, bounds, loads, moves, allocs, bins, crops]) if (r.error) throw r.error

  // The boundary in effect at the end of the crop year (else the earliest).
  const eoy = `${year}-12-31`
  const versions = (bounds.data ?? []) as { acres: unknown; valid_from: string | null; valid_to: string | null }[]
  const current =
    versions.find((b) => (!b.valid_from || b.valid_from <= eoy) && (!b.valid_to || b.valid_to > eoy)) ??
    [...versions].sort((a, b) => (a.valid_from ?? '').localeCompare(b.valid_from ?? ''))[0]

  const binName = new Map((bins.data ?? []).map((b) => [b.id, b.name as string]))
  const lbPerBu = new Map((crops.data ?? []).map((c) => [c.id, num(c.test_weight_lb_per_bu) ?? 50]))

  const kgByBin = new Map<string, { kg: number; from: string }>()
  const add = (binId: string | null, kg: number, from: string) => {
    if (!binId || !(kg > 0)) return
    const cur = kgByBin.get(binId)
    if (cur && cur.from !== from) return
    kgByBin.set(binId, { kg: (cur?.kg ?? 0) + kg, from })
  }
  const loadRows = loads.data ?? []
  // A load that filled one bin and went on into another: each bin its share.
  for (const l of loadRows)
    for (const b of [l.bin_id, l.overflow_bin_id].filter((x): x is string => !!x)) add(b, l.overflow_bin_id ? loadInBin(l, b).kg : (num(l.net_kg) ?? 0), 'scale loads')
  if (!kgByBin.size) {
    // Loads mirror into the movements as "load:<id>"; only the rest are new.
    for (const m of moves.data ?? []) if (!m.ticket_number?.startsWith('load:')) add(m.bin_id, bushelsToKg(num(m.bushels) ?? 0, lbPerBu.get(m.crop_id ?? '') ?? 50), 'bin map')
  }
  const planned = (allocs.data ?? []).map((a) => ({ ...a, bu: num(a.actual_bu) ?? num(a.estimated_bu) }))
  const binsOut: BinSuggestion[] = kgByBin.size
    ? [...kgByBin].map(([bin_id, v]) => ({ bin_id, name: binName.get(bin_id) ?? 'Bin', kg: Math.round(v.kg), from: v.from }))
    : planned.map((a) => ({
        bin_id: a.bin_id,
        name: binName.get(a.bin_id) ?? 'Bin',
        kg: a.bu == null ? null : Math.round(bushelsToKg(a.bu, lbPerBu.get(a.crop_id ?? '') ?? 50)),
        from: a.actual_bu != null ? 'bin plan (actual)' : 'bin plan (estimate)',
      }))
  binsOut.sort((a, b) => binNumber(a.name) - binNumber(b.name) || a.name.localeCompare(b.name))

  const totalLoads = loadRows.reduce((s, l) => s + (num(l.net_kg) ?? 0), 0)
  const totalKg = totalLoads > 0 ? Math.round(totalLoads) : binsOut.every((b) => b.kg != null) && binsOut.length ? binsOut.reduce((s, b) => s + (b.kg ?? 0), 0) : null

  const fin = finishedFor(finishedDays((finishes.data ?? []) as never, year), fieldId, null)
  const lastLoad = loadRows.filter((l) => l.last_from_field && l.loaded_on).map((l) => l.loaded_on as string).sort().pop() ?? null
  const jd = (ops.data ?? []).map((o) => o.ended_at ?? o.started_at).filter((v): v is string => !!v).map((v) => farmDay(v)).sort().pop() ?? null
  const harvest = effectiveHarvestDate({ finishedOn: fin?.finished ?? null, typed: typed.data?.[0]?.harvest_date ?? null, lastLoadOn: lastLoad, jdLastPassOn: jd }, { today })

  // The harvest day's weather, 10 am – 5 pm on the farm (Mountain, UTC−6 in season).
  let weather: string | null = null
  if (harvest.date) {
    try {
      const w = await weatherForField(fieldId, { from: `${harvest.date}T16:00:00Z`, to: `${harvest.date}T23:00:00Z` })
      weather = weatherText(w?.weather)
    } catch {
      weather = null
    }
  }

  return {
    legal: legalAs(field.data?.legal_land_description),
    gpsAcres: num(current?.acres),
    totalKg,
    harvestOn: harvest.date,
    harvestFrom: harvest.source ? HARVEST_FROM[harvest.source] : null,
    weather,
    bins: binsOut,
  }
}

/* ── The reports ───────────────────────────────────────────────────────── */

/**
 * A field's report for the year: the one for the company named, else any one
 * kept for the field (a report already started stays the field's report even
 * when its plan no longer names that company).
 */
export function useSeedReport(fieldId: string | null, year: number, company: string | null) {
  return useQuery({
    queryKey: ['seed_forms', 'report', company, year, fieldId],
    enabled: !!fieldId,
    queryFn: async () => {
      const { data: reports, error } = await supabase.from('seed_reports').select('*').eq('crop_year', year).eq('field_id', fieldId!).order('created_at')
      if (error) throw error
      const report = pickReport(reports ?? [], company)
      if (!report) return { report: null, bins: [] as SeedReportBin[] }
      const { data: bins, error: e2 } = await supabase.from('seed_report_bins').select('*').eq('report_id', report.id).order('sort').order('created_at')
      if (e2) throw e2
      return { report: report as SeedReport, bins: (bins ?? []) as SeedReportBin[] }
    },
  })
}

/** The report for the company named, else the field's first. */
export function pickReport<T extends { company: string }>(reports: T[], company: string | null): T | null {
  const want = company?.trim().toLowerCase()
  return (want && reports.find((r) => r.company.trim().toLowerCase() === want)) || reports[0] || null
}

const invalidate = (qc: ReturnType<typeof useQueryClient>) => void qc.invalidateQueries({ queryKey: ['seed_forms'] })

/** Starts a field's report with everything the app knows already on it. */
export function useStartSeedReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { fieldId: string; year: number; company: string; grower: string | null; legalAs?: (lld: string | null | undefined) => string | null }) => {
      const s = await suggestSeedReport(v.fieldId, v.year, v.legalAs)
      const { data: report, error } = await supabase
        .from('seed_reports')
        .insert({
          company: v.company,
          crop_year: v.year,
          field_id: v.fieldId,
          grower_name: v.grower,
          legal_land: s.legal,
          gps_acres: s.gpsAcres,
          total_kg: s.totalKg,
          harvest_completed_on: s.harvestOn,
          weather: s.weather,
        })
        .select('id')
        .single()
      if (error) throw error
      if (s.bins.length) {
        const { error: e2 } = await supabase
          .from('seed_report_bins')
          .insert(s.bins.map((b, i) => ({ report_id: report.id, bin_id: b.bin_id, quantity_kg: b.kg, sort: i })))
        if (e2) throw e2
      }
      return s
    },
    onSuccess: () => invalidate(qc),
  })
}

export function useSaveSeedReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; patch: Partial<SeedReport> }) => {
      const { error } = await supabase
        .from('seed_reports')
        .update({ ...v.patch, updated_at: new Date().toISOString() })
        .eq('id', v.id)
      if (error) throw error
    },
    onSuccess: () => invalidate(qc),
  })
}

/** Signs as the person signed in, with their own saved signature; or takes the signature off. */
export function useSignSeedReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; userId: string; signature: string } | { id: string; unsign: true }) => {
      const patch =
        'unsign' in v
          ? { signature: null, signed_by: null, signed_at: null }
          : { signature: v.signature, signed_by: v.userId, signed_at: new Date().toISOString() }
      const { error } = await supabase.from('seed_reports').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: () => invalidate(qc),
  })
}

export function useSaveSeedBin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id?: string; report_id: string; patch: Partial<SeedReportBin> }) => {
      const { error } = v.id
        ? await supabase.from('seed_report_bins').update({ ...v.patch, updated_at: new Date().toISOString() }).eq('id', v.id)
        : await supabase.from('seed_report_bins').insert({ ...v.patch, report_id: v.report_id })
      if (error) throw error
    },
    onSuccess: () => invalidate(qc),
  })
}

export function useDeleteSeedBin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('seed_report_bins').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => invalidate(qc),
  })
}

/** Everything blank on the report (and its bins' kilograms) filled from the app; nothing typed is touched. */
export function blanksFromApp(report: SeedReport, bins: SeedReportBin[], s: Suggestion) {
  const patch: Partial<SeedReport> = {}
  if (!report.legal_land && s.legal) patch.legal_land = s.legal
  if (report.gps_acres == null && s.gpsAcres != null) patch.gps_acres = s.gpsAcres
  if (report.total_kg == null && s.totalKg != null) patch.total_kg = s.totalKg
  if (!report.harvest_completed_on && s.harvestOn) patch.harvest_completed_on = s.harvestOn
  if (!report.weather && s.weather) patch.weather = s.weather
  const have = new Set(bins.map((b) => b.bin_id))
  const newBins = s.bins.filter((b) => !have.has(b.bin_id))
  const binKg = bins.flatMap((b) => {
    const sug = s.bins.find((x) => x.bin_id === b.bin_id)
    return b.quantity_kg == null && sug?.kg != null ? [{ id: b.id, kg: sug.kg }] : []
  })
  return { patch, newBins, binKg }
}

/* ── Onto the forms ────────────────────────────────────────────────────── */

export function reportForm(r: SeedReport, bins: SeedReportBin[], binName: (id: string | null) => string): SeedReportForm {
  return {
    grower: r.grower_name,
    fieldNumber: r.field_number,
    legal: r.legal_land,
    spinCode: r.spin_code,
    gpsAcres: num(r.gps_acres),
    totalKg: num(r.total_kg),
    method: r.weight_method,
    certified: r.scale_certified,
    signature: r.signature,
    signedOn: r.signed_at ? new Date(r.signed_at).toLocaleDateString('en-CA') : null,
    storage: r.storage,
    storageOther: r.storage_other,
    bins: bins.map((b) => ({
      companyBinId: b.company_bin_id,
      growerBin: growerBinLabel(binName(b.bin_id)),
      kg: num(b.quantity_kg),
      moisturePct: num(b.moisture_pct),
      seedTempC: num(b.seed_temp_c),
      tempCables: b.temp_cables,
      moistureCables: b.moisture_cables,
      aeration: b.aeration,
      bottom: b.bottom,
    })),
    harvestOn: r.harvest_completed_on,
    weather: r.weather,
    acknowledged: r.acknowledged,
  }
}
