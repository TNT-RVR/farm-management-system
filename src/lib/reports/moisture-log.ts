import { supabase } from '@/lib/supabase'
import { farmTz } from '@/lib/farm-context'
import { bandRanges, chartSummary, gradeLabel, type Grade, type MoistureBands } from '@/lib/moisture'
import { fetchAll, num, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * Every moisture test of a crop year, as Harvest → Moisture lists them:
 * when, which field and bin, the reading, the grain temperature, the meter
 * reading and the chart it was read on, the grade and the band it fell in for
 * that crop, and who tested it. Grouped by crop, because the bands are the
 * crop's.
 */

export const MOISTURE_COLUMNS = [
  { label: 'Date' },
  { label: 'Time' },
  { label: 'Field' },
  { label: 'Bin' },
  { label: 'Moisture (%)', decimals: 1 },
  { label: 'Temp (°C)', decimals: 1 },
  { label: 'Meter', upTo: 2 },
  { label: 'Chart' },
  { label: 'Grade' },
  { label: 'Band (%)' },
  { label: 'Sample' },
  { label: 'Tested by' },
  { label: 'Note' },
]

export type MTest = {
  tested_at: string
  field_id: string | null
  crop_id: string | null
  bin_id: string | null
  temperature_c: unknown
  meter_reading: unknown
  chart_key: string | null
  moisture_pct: unknown
  grade: string | null
  entered_by_hand: boolean | null
  note: string | null
  created_by: string | null
  sample_condition: string | null
}

export type MCrop = { id: string; name: string; moisture_dry_min: unknown; moisture_dry_max: unknown; moisture_tough_max: unknown; moisture_damp_max: unknown; moisture_moist_max: unknown }

export const cropBands = (c: MCrop): MoistureBands => ({
  dry_min: num(c.moisture_dry_min),
  dry_max: num(c.moisture_dry_max),
  tough_max: num(c.moisture_tough_max),
  damp_max: num(c.moisture_damp_max),
  moist_max: num(c.moisture_moist_max),
})

/** The farm's day and time of a test. */
export function localStamp(iso: string, tz = farmTz()): { date: string; time: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: iso.slice(0, 10), time: '' }
  return { date: d.toLocaleDateString('en-CA', { timeZone: tz }), time: d.toLocaleTimeString('en-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }) }
}

export function moistureGroups(tests: MTest[], crops: MCrop[], names: { field: (id: string | null) => string | null; bin: (id: string | null) => string | null; person: (id: string | null) => string | null }, tz?: string): { groups: ReportGroup[]; needAir: number } {
  const cropById = new Map(crops.map((c) => [c.id, c]))
  const byCrop = new Map<string, { at: string; cells: Cell[] }[]>()
  let needAir = 0
  for (const t of tests) {
    const crop = t.crop_id ? cropById.get(t.crop_id) : undefined
    const g = (t.grade ?? null) as Grade | null
    if (g && g !== 'dry' && g !== 'too_dry') needAir++
    const band = crop && g ? bandRanges(cropBands(crop)).find((b) => b.grade === g)?.range : undefined
    const chart = chartSummary(t.chart_key)
    const when = localStamp(t.tested_at, tz)
    const name = crop?.name ?? 'Crop not set'
    byCrop.set(name, [
      ...(byCrop.get(name) ?? []),
      {
        at: t.tested_at,
        cells: [
          when.date,
          when.time,
          names.field(t.field_id),
          names.bin(t.bin_id),
          num(t.moisture_pct),
          num(t.temperature_c),
          num(t.meter_reading),
          t.entered_by_hand ? 'entered by hand' : chart ? `${chart.crop} (table ${chart.table_no})` : t.chart_key,
          g ? gradeLabel(g) : null,
          band ?? null,
          t.sample_condition,
          names.person(t.created_by),
          t.note,
        ],
      },
    ])
  }
  const groups = [...byCrop.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([title, rows]) => {
      rows.sort((a, b) => a.at.localeCompare(b.at))
      const vals = rows.map((r) => r.cells[4]).filter((v): v is number => typeof v === 'number')
      const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
      return {
        title,
        note: `${rows.length} test${rows.length === 1 ? '' : 's'}${avg != null ? ` · average ${avg.toFixed(1)}%, ${Math.min(...vals).toFixed(1)}–${Math.max(...vals).toFixed(1)}%` : ''}`,
        rows: rows.map((r) => r.cells),
      }
    })
  return { groups, needAir }
}

export async function gatherMoistureLog(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const [tests, crops, fields, bins, users] = await Promise.all([
    fetchAll<MTest>((a, b) =>
      supabase
        .from('moisture_tests')
        .select('tested_at, field_id, crop_id, bin_id, temperature_c, meter_reading, chart_key, moisture_pct, grade, entered_by_hand, note, created_by, sample_condition')
        .eq('crop_year', year)
        .order('tested_at')
        .order('id')
        .range(a, b),
    ),
    fetchAll<MCrop>((a, b) => supabase.from('crops').select('id, name, moisture_dry_min, moisture_dry_max, moisture_tough_max, moisture_damp_max, moisture_moist_max').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('fields').select('id, name').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('bins').select('id, name').order('id').range(a, b)),
    fetchAll<{ id: string; full_name: string }>((a, b) => supabase.from('users').select('id, full_name').order('id').range(a, b)),
  ])
  if (!tests.length) throw new Error(`No moisture tests recorded for ${year}.`)
  const name = <T extends { id: string }>(xs: T[], pick: (x: T) => string) => {
    const m = new Map(xs.map((x) => [x.id, pick(x)]))
    return (id: string | null) => (id ? (m.get(id) ?? null) : null)
  }
  const r = moistureGroups(tests, crops, { field: name(fields, (f) => f.name), bin: name(bins, (b) => b.name), person: name(users, (u) => u.full_name) })
  return {
    title: 'Moisture test log',
    subtitle: `Crop year ${year}`,
    meta: [
      ['Tests', tests.length],
      ['Crops', r.groups.length],
      ['Tough or wetter', r.needAir],
    ],
    summary: [
      'Every moisture test this crop year, by crop: the reading, the grain temperature, the meter reading and the chart it was read off, and the grade and band it fell in on the crop’s own moisture bands (Crop settings). A reading entered by hand was not read off a chart.',
    ],
    columns: MOISTURE_COLUMNS,
    groups: r.groups,
    groupLabel: 'Crop',
    orientation: 'landscape',
    filename: `Moisture tests ${year}`,
  }
}
