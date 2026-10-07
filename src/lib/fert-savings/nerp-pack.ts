import { supabase } from '../supabase'
import { BRAND } from '@/config/brand'
import { appliedFertiliser } from '../fertility-rx'
import { analysisOf, farmTypical, type ManureApplication } from '../manure-credit'
import type { FieldOperation } from '../fieldOps'
import type { FieldRequirement } from '../fertilizer-plan'
import type { ReportSection, TableReport } from '../table-report'

/**
 * The 4R / NERP record pack for a season: per field, what was planned (the
 * soil test and the written recommendation) and what happened (the passes the
 * machines logged, manure, tissue tests, the yield), then the season's
 * fertilizer invoices. It is the paper trail a 4R audit, a NERP project or an
 * OFCAF claim asks for — assembled from what the app already holds, so
 * nobody types it twice.
 */

type Inputs = {
  fields: { id: string; name: string; legal_land_description?: string | null; soil_texture?: string | null }[]
  requirements: FieldRequirement[]
  history: { field_id: string; crop_year: number; yield_per_acre: number | null; yield_unit: string | null; acres: number | null; crop: string | null }[]
  manure: unknown[]
  irrigated: Set<string>
  planFor: (fieldId: string) => { crop_id: string | null; planned_acres?: number | null } | null
  cropOf: (id: string | null | undefined) => { name: string } | null
}

const d = (s: string | null | undefined) => (s ? s.slice(0, 10) : '')
const r1 = (v: unknown) => (v == null || v === '' ? null : Math.round(Number(v) * 10) / 10)

export async function buildNerpPack(fieldIds: string[], year: number, inputs: Inputs, farmName: string = BRAND.farmName): Promise<TableReport> {
  const [ops, reports, tissue, purchases] = await Promise.all([
    supabase
      .from('jd_field_operations')
      .select('id, field_id, crop_season, operation_type, started_at, products')
      .or('not_ours.is.null,not_ours.eq.rented_out')
      .eq('crop_season', year)
      .eq('operation_type', 'application')
      .in('field_id', fieldIds),
    supabase
      .from('soil_test_reports')
      .select('id, field_id, crop_year, report_date, lab, soil_test_samples(sample_code, depth_top_in, depth_bottom_in, no3n_lb_ac, p_bicarb_ppm, k_ppm, so4s_ppm, ph, ec_ms_cm, om_pct)')
      .in('field_id', fieldIds)
      .lte('crop_year', year)
      .order('crop_year', { ascending: false }),
    supabase.from('tissue_tests').select('*').eq('crop_year', year).in('field_id', fieldIds),
    supabase
      .from('product_purchases')
      .select('invoice_date, supplier, invoice_no, description, quantity, pack_unit, unit_price, amount')
      .gte('invoice_date', `${year - 1}-08-01`)
      .lte('invoice_date', `${year}-07-31`)
      .order('invoice_date'),
  ])
  for (const x of [ops, reports, tissue]) if (x.error) throw x.error
  const farm = farmTypical(inputs.manure as ManureApplication[])

  const sections: ReportSection[] = []
  const summary: (string | number | null)[][] = []

  for (const id of fieldIds) {
    const field = inputs.fields.find((f) => f.id === id)
    const name = field?.name ?? 'Field'
    const plan = inputs.planFor(id)
    const crop = inputs.cropOf(plan?.crop_id)?.name ?? null
    const req = inputs.requirements.find((r) => r.fieldId === id)
    const hist = inputs.history.find((h) => h.field_id === id && h.crop_year === year)
    const acres = req?.acres ?? plan?.planned_acres ?? null

    // SOURCE / RATE / TIME / PLACE — as applied.
    const passes = appliedFertiliser((ops.data ?? []).filter((o) => o.field_id === id) as FieldOperation[])
    const tot = passes.reduce(
      (a, p) => (p.nutrients ? { n: a.n + p.nutrients.n, p: a.p + p.nutrients.p2o5, k: a.k + p.nutrients.k2o, s: a.s + p.nutrients.s } : a),
      { n: 0, p: 0, k: 0, s: 0 },
    )
    summary.push([
      name,
      field?.legal_land_description ?? null,
      crop,
      r1(acres),
      inputs.irrigated.has(id) ? 'irrigated' : 'dryland',
      Math.round(tot.n),
      Math.round(tot.p),
      Math.round(tot.k),
      Math.round(tot.s),
      hist?.yield_per_acre != null ? `${r1(hist.yield_per_acre)} ${hist.yield_unit ?? ''}`.trim() : null,
    ])

    const report = (reports.data ?? []).find((r) => r.field_id === id)
    const samples = ((report?.soil_test_samples ?? []) as { sample_code: string; depth_top_in: number | null; depth_bottom_in: number | null; no3n_lb_ac: number | null; p_bicarb_ppm: number | null; k_ppm: number | null; so4s_ppm: number | null; ph: number | null; ec_ms_cm: number | null; om_pct: number | null }[]).sort(
      (a, b) => a.sample_code.localeCompare(b.sample_code),
    )
    sections.push({
      title: `${name} — soil test`,
      note: report ? `${report.crop_year} crop year · sampled ${d(report.report_date) || 'date not recorded'} · ${report.lab ?? 'lab not recorded'}` : 'No soil test on file.',
      head: ['Site', 'Depth (in)', 'NO3-N lb/ac', 'Olsen P ppm', 'K ppm', 'SO4-S ppm', 'pH', 'EC dS/m', 'OM %'],
      rows: samples.map((s) => [s.sample_code, `${s.depth_top_in ?? ''}-${s.depth_bottom_in ?? ''}`, r1(s.no3n_lb_ac), r1(s.p_bicarb_ppm), r1(s.k_ppm), r1(s.so4s_ppm), r1(s.ph), r1(s.ec_ms_cm), r1(s.om_pct)]),
    })
    sections.push({
      title: `${name} — recommendation (right rate, source, time)`,
      head: ['Nutrient', 'Product', 'lb/ac nutrient', 'lb/ac product', 'Timing / placement', 'Why'],
      rows: (req?.lines ?? []).map((l) => [l.nutrient, l.product, r1(l.lbPerAc), r1(l.productLbPerAc), l.timing, l.note]),
    })
    sections.push({
      title: `${name} — applied (as the machines logged it)`,
      head: ['Date', 'Product', 'Rate', 'Unit', 'N', 'P2O5', 'K2O', 'S'],
      rows: passes.map((p) => [p.date, p.product, r1(p.rate), p.unitId, r1(p.nutrients?.n), r1(p.nutrients?.p2o5), r1(p.nutrients?.k2o), r1(p.nutrients?.s)]),
    })
    const spreads = (inputs.manure as ManureApplication[]).filter((m) => m.field_id === id && m.crop_year === year)
    if (spreads.length) {
      sections.push({
        title: `${name} — manure`,
        head: ['Spread', 'Rate t/ac', 'Acres', 'Kind', 'Worked in (days)', 'N-P2O5-K2O lb/ton', 'Analysis'],
        rows: spreads.map((m) => {
          const a = analysisOf(m, farm)
          return [d(m.applied_on), r1(m.rate_tons_per_acre), r1(m.acres), m.manure_type ?? '', m.incorporated_days ?? (m.incorporated === false ? 'not worked in' : ''), `${a.n}-${a.p2o5}-${a.k2o}`, a.measured ? 'lab test' : farm ? 'farm average' : 'Alberta typical']
        }),
      })
    }
    const tt = (tissue.data ?? []).filter((t) => t.field_id === id)
    if (tt.length) {
      sections.push({
        title: `${name} — tissue tests`,
        head: ['Sampled', 'Stage', 'N %', 'P %', 'K %', 'S %', 'Petiole NO3-N ppm'],
        rows: tt.map((t) => [t.sampled_on, t.growth_stage, r1(t.n_pct), r1(t.p_pct), r1(t.k_pct), r1(t.s_pct), r1(t.no3n_ppm)]),
      })
    }
  }

  sections.unshift({
    title: 'Fields — nutrients applied (lb/ac) and yield',
    head: ['Field', 'LLD', 'Crop', 'Acres', 'Water', 'N', 'P2O5', 'K2O', 'S', 'Yield'],
    rows: summary,
  })
  sections.push({
    title: `Fertilizer invoices, Aug ${year - 1} – Jul ${year}`,
    note: purchases.error ? `Invoices could not be read: ${purchases.error.message}` : undefined,
    head: ['Date', 'Supplier', 'Invoice', 'Product', 'Quantity', 'Unit', 'Price', 'Amount'],
    rows: (purchases.data ?? []).map((p) => [p.invoice_date, p.supplier, p.invoice_no, p.description, r1(p.quantity), p.pack_unit, r1(p.unit_price), r1(p.amount)]),
  })

  return {
    title: `4R / NERP record — ${year}`,
    meta: [
      ['Farm', farmName],
      ['Crop year', year],
      ['Fields', fieldIds.length],
      ['Generated', new Date().toLocaleString('en-CA')],
    ],
    sections,
  }
}
