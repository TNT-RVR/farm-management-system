import { supabase } from '@/lib/supabase'
import { fetchMonitorYear, type MonitorRow } from '@/lib/bin-monitor-data'
import { binNumber } from '@/lib/bins'
import { growerBinLabel } from '@/lib/seed-forms/format'
import { binTempTable, type BinTempRecord } from '@/lib/seed-forms/generic'
import type { GatherContext, ParamValues, SectionedReport } from './framework'
import { yearParam } from './framework'

/**
 * Bin temperature monitoring record (24 Oct 2026): every bin's cable readings
 * for a crop year as a record a seed company (or anyone) can be handed, one
 * table a bin. Any bin, any crop; the seed report's company and bin label are
 * added where the bin is on one.
 */

type SeedBin = { bin_id: string | null; company_bin_id: string | null; company: string; legal: string | null; grower: string | null }

/** The records from the rows read: a bin each, numbered bins in order. */
export function binTempRecords(o: {
  readings: MonitorRow[]
  binName: (id: string) => string
  cropName: (id: string | null) => string | null
  variety: (binId: string) => string | null
  seedBins: SeedBin[]
}): BinTempRecord[] {
  const byBin = new Map<string, MonitorRow[]>()
  for (const r of o.readings) byBin.set(r.bin_id, [...(byBin.get(r.bin_id) ?? []), r])
  return [...byBin.entries()]
    .map(([id, rows]) => {
      const seed = o.seedBins.find((s) => s.bin_id === id)
      const latest = [...rows].sort((a, b) => b.read_on.localeCompare(a.read_on))
      return {
        bin: growerBinLabel(o.binName(id)) || 'Bin',
        companyBin: seed?.company_bin_id ?? null,
        crop: o.cropName(latest.find((r) => r.crop_id)?.crop_id ?? null),
        variety: o.variety(id),
        lot: latest.find((r) => r.lot_number)?.lot_number ?? null,
        legal: latest.find((r) => r.lld)?.lld ?? seed?.legal ?? null,
        company: seed?.company ?? null,
        readings: rows.map((r) => ({ date: r.read_on, initials: r.initials, levels: r.levels, aeration: r.aeration_on, notes: r.notes })),
      }
    })
    .sort((a, b) => binNumber(a.bin) - binNumber(b.bin) || a.bin.localeCompare(b.bin, undefined, { numeric: true }))
}

export async function gatherBinTemperatureRecord(p: ParamValues, ctx: GatherContext): Promise<SectionedReport> {
  const year = yearParam(p, ctx)
  const all = await fetchMonitorYear(year)
  const readings = p.bin ? all.filter((r) => r.bin_id === p.bin) : all
  if (!readings.length) throw new Error(p.bin ? `That bin has no cable readings for ${year}.` : `No bin has cable readings for ${year}.`)
  const [bins, crops, contents, reports] = await Promise.all([
    supabase.from('bins').select('id, name'),
    supabase.from('crops').select('id, name'),
    supabase.from('bin_contents').select('bin_id, variety, crop_year').eq('crop_year', year),
    supabase.from('seed_reports').select('id, company, legal_land, grower_name').eq('crop_year', year),
  ])
  for (const r of [bins, crops, contents, reports]) if (r.error) throw r.error
  const reportIds = (reports.data ?? []).map((r) => r.id)
  const seedBinRows = reportIds.length ? await supabase.from('seed_report_bins').select('report_id, bin_id, company_bin_id').in('report_id', reportIds) : { data: [], error: null }
  if (seedBinRows.error) throw seedBinRows.error
  const reportById = new Map((reports.data ?? []).map((r) => [r.id, r]))
  const seedBins: SeedBin[] = (seedBinRows.data ?? []).map((b) => {
    const r = reportById.get(b.report_id)
    return { bin_id: b.bin_id, company_bin_id: b.company_bin_id, company: r?.company ?? '', legal: r?.legal_land ?? null, grower: r?.grower_name ?? null }
  })
  const binNames = new Map((bins.data ?? []).map((b) => [b.id, b.name as string]))
  const cropNames = new Map((crops.data ?? []).map((c) => [c.id, c.name as string]))
  const records = binTempRecords({
    readings,
    binName: (id) => binNames.get(id) ?? 'Bin',
    cropName: (id) => (id ? (cropNames.get(id) ?? null) : null),
    variety: (id) => (contents.data ?? []).find((c) => c.bin_id === id && c.variety)?.variety ?? null,
    seedBins,
  })
  const grower = seedBins.find((s) => s.grower && records.some((r) => r.company === s.company))?.grower ?? null
  const one = p.bin && records[0] ? ` ${records[0].bin}` : ''
  return { ...binTempTable(records, { cropYear: year, grower }), filename: `Bin temperature record${one} ${year}` }
}
