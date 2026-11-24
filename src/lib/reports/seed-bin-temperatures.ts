import { supabase } from '@/lib/supabase'
import type { MonitorRow } from '@/lib/bin-monitor-data'
import { growerBinLabel } from '@/lib/seed-forms/format'
import { pickReport, type SeedReport, type SeedReportBin } from '@/lib/seed-forms/data'
import { binTempRecord, formStyleFor } from '@/lib/seed-forms/styles'
import { binTempTable } from '@/lib/seed-forms/generic'
import { yearParam, type GatherContext, type Made, type ParamValues } from './framework'

/**
 * A seed field's bin temperature records for the company it is grown for, on
 * that company's own form when the app has it (Corteva's), else the plain one
 * — the same file Harvest reports → Bin temperatures makes, here so the Bin
 * sensor report can make it too (Sam, 23 Nov 2026). The bins are the ones on
 * the field's seed report; the readings are typed on Harvest reports.
 *
 * PDF is the company's form; CSV is the plain record's table.
 */

const safeName = (s: string) => s.replace(/[^\w\s.-]+/g, ' ').trim()

export async function gatherSeedBinTemperatures(p: ParamValues, ctx: GatherContext): Promise<Made> {
  const year = yearParam(p, ctx)
  if (!p.field) throw new Error('Choose the seed field.')
  const [reports, field] = await Promise.all([
    supabase.from('seed_reports').select('*').eq('crop_year', year).eq('field_id', p.field).order('created_at'),
    supabase.from('fields').select('name').eq('id', p.field).maybeSingle(),
  ])
  if (reports.error) throw reports.error
  const fieldName = field.data?.name ?? 'Field'
  const report = pickReport((reports.data ?? []) as SeedReport[], null)
  if (!report) throw new Error(`${fieldName} has no seed report for ${year}. Start one on Harvest reports → Seed report.`)

  const { data: binRows, error: e1 } = await supabase.from('seed_report_bins').select('*').eq('report_id', report.id).order('sort').order('created_at')
  if (e1) throw e1
  const all = (binRows ?? []) as SeedReportBin[]
  const bins = p.bin ? all.filter((b) => b.bin_id === p.bin) : all
  if (!all.length) throw new Error(`${fieldName}'s seed report has no bins on it yet.`)
  if (!bins.length) throw new Error(`That bin is not on ${fieldName}'s seed report.`)

  const ids = bins.map((b) => b.bin_id).filter((v): v is string => !!v)
  const [readings, binNames, crops] = await Promise.all([
    ids.length ? supabase.from('bin_monitor_readings').select('*').in('bin_id', ids).eq('crop_year', year).order('read_on') : Promise.resolve({ data: [], error: null }),
    supabase.from('bins').select('id, name'),
    supabase.from('crops').select('id, name'),
  ])
  for (const r of [readings, binNames, crops]) if (r.error) throw r.error
  const rows = (readings.data ?? []).map((r) => ({ ...r, levels: Array.isArray(r.levels) ? r.levels : [] })) as unknown as MonitorRow[]
  const binName = (id: string | null) => binNames.data?.find((b) => b.id === id)?.name ?? ''
  const cropName = (id: string | null) => crops.data?.find((c) => c.id === id)?.name ?? null

  const style = formStyleFor(report.company)
  const input = { report, bins, binName, fieldName, signerName: null, readings: rows, cropName }
  const one = p.bin && bins[0] ? ` - ${bins[0].company_bin_id || growerBinLabel(binName(bins[0].bin_id)) || 'bin'}` : ''
  const filename = `${style.fileLabel(report.company)} bin temperatures - ${safeName(fieldName)}${one} - ${year}`
  if (ctx.format === 'CSV') {
    return { ...binTempTable(bins.map((b) => binTempRecord(input, b)), { cropYear: year, grower: report.grower_name }), filename }
  }
  return { blob: await style.binTempPdf(input), filename: `${filename}.pdf` }
}
