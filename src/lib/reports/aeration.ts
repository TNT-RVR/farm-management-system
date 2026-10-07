import { supabase } from '@/lib/supabase'
import { flagsFor, type Level } from '@/lib/bin-monitor'
import { gradeLabel, needsAir, type Grade } from '@/lib/moisture'
import { binNumber } from '@/lib/bins'
import { fetchAll, longDate, num, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'
import { localStamp } from './moisture-log'

/**
 * The storage season bin by bin: every sensor-cable reading (the coolest and
 * warmest level, the wettest, and what the readings say against the one
 * before — heating, warm canola, above the dry standard), single readings
 * from a bin probe, moisture tests of grain going in, and the needs-air
 * alerts with what was done about them.
 *
 * There is no fan log in the app: when air went on is not recorded, so the
 * action column is what the alert was closed with and what the readings
 * called for.
 */

export const AERATION_COLUMNS = [
  { label: 'Date' },
  { label: 'Record' },
  { label: 'By' },
  { label: 'Coolest (°C)', decimals: 1 },
  { label: 'Warmest (°C)', decimals: 1 },
  { label: 'Moisture (%)', decimals: 1 },
  { label: 'Condition' },
  { label: 'Action' },
]

export type ACrop = { id: string; name: string; moisture_dry_max: unknown }
export type AReading = { bin_id: string; crop_id: string | null; read_on: string; initials: string | null; levels: unknown; notes: string | null }
export type AProbe = { bin_id: string; reading_at: string; moisture_pct: unknown; temp_c: unknown; source: string | null }
export type ATest = { bin_id: string | null; field_id: string | null; crop_id: string | null; tested_at: string; moisture_pct: unknown; temperature_c: unknown; grade: string | null; note: string | null }
export type AAlert = { bin_id: string | null; field_id: string | null; crop_id: string | null; moisture_pct: unknown; grade: string | null; raised_at: string; dismissed_at: string | null; dismissed_note: string | null }

const levelsOf = (v: unknown): Level[] => (Array.isArray(v) ? (v as Level[]) : [])
const extreme = (xs: (number | null)[], pick: 'min' | 'max') => {
  const vals = xs.filter((x): x is number => x != null && Number.isFinite(x))
  return vals.length ? (pick === 'min' ? Math.min(...vals) : Math.max(...vals)) : null
}

/** The range's records, a group per bin (and one for alerts on a field's grain with no bin), oldest first. */
export function aerationGroups(
  d: { readings: AReading[]; probes: AProbe[]; tests: ATest[]; alerts: AAlert[] },
  crops: ACrop[],
  names: { bin: (id: string) => string; field: (id: string | null) => string | null },
  tz?: string,
): { groups: ReportGroup[]; flagged: number } {
  const cropById = new Map(crops.map((c) => [c.id, c]))
  const byBin = new Map<string, { at: string; cells: Cell[] }[]>()
  const add = (key: string, at: string, cells: Cell[]) => byBin.set(key, [...(byBin.get(key) ?? []), { at, cells }])
  let flagged = 0

  const sorted = [...d.readings].sort((a, b) => a.read_on.localeCompare(b.read_on))
  const last = new Map<string, Level[]>()
  for (const r of sorted) {
    const crop = r.crop_id ? cropById.get(r.crop_id) : undefined
    const now = levelsOf(r.levels).filter((l) => !l.air)
    const flags = flagsFor(crop?.name, now, last.get(r.bin_id) ?? null, num(crop?.moisture_dry_max))
    last.set(r.bin_id, now)
    if (flags.length) flagged++
    const heating = flags.some((f) => f.kind === 'heating' || f.kind === 'warm')
    const wet = flags.some((f) => f.kind === 'wet' || f.kind === 'damp')
    add(r.bin_id, r.read_on, [
      r.read_on,
      `cable, ${now.length} level${now.length === 1 ? '' : 's'}`,
      r.initials,
      extreme(now.map((l) => num(l.temp_c)), 'min'),
      extreme(now.map((l) => num(l.temp_c)), 'max'),
      extreme(now.map((l) => num(l.moisture_pct)), 'max'),
      flags.length ? flags.map((f) => `L${f.level} ${f.text}`).join('; ') : 'nothing flagged',
      [heating ? 'air on to cool it' : null, wet ? 'air on, or dry it' : null, r.notes].filter(Boolean).join('; ') || null,
    ])
  }
  for (const p of d.probes) {
    const when = localStamp(p.reading_at, tz)
    add(p.bin_id, p.reading_at.slice(0, 10), [when.date, `probe${p.source ? ` (${p.source})` : ''}`, null, num(p.temp_c), num(p.temp_c), num(p.moisture_pct), null, null])
  }
  for (const t of d.tests) {
    if (!t.bin_id) continue
    const g = (t.grade ?? null) as Grade | null
    const when = localStamp(t.tested_at, tz)
    add(t.bin_id, when.date, [when.date, 'moisture test going in', null, num(t.temperature_c), num(t.temperature_c), num(t.moisture_pct), g ? gradeLabel(g) : null, [needsAir(g) ? 'needs air' : null, t.note].filter(Boolean).join('; ') || null])
  }
  for (const a of d.alerts) {
    const g = (a.grade ?? null) as Grade | null
    const when = localStamp(a.raised_at, tz)
    const key = a.bin_id ?? `field:${a.field_id ?? ''}`
    const closed = a.dismissed_at ? `closed ${localStamp(a.dismissed_at, tz).date}${a.dismissed_note ? `: ${a.dismissed_note}` : ''}` : 'still open'
    add(key, when.date, [when.date, 'needs-air alert', null, null, null, num(a.moisture_pct), g ? gradeLabel(g) : null, closed])
  }

  const title = (key: string) => (key.startsWith('field:') ? `No bin — grain off ${names.field(key.slice(6)) ?? 'a field'}` : names.bin(key))
  const groups = [...byBin.entries()]
    .sort((a, b) => {
      const fa = a[0].startsWith('field:')
      const fb = b[0].startsWith('field:')
      if (fa !== fb) return fa ? 1 : -1
      const ta = title(a[0])
      const tb = title(b[0])
      return binNumber(ta) - binNumber(tb) || ta.localeCompare(tb)
    })
    .map(([key, rows]) => {
      rows.sort((a, b) => a.at.localeCompare(b.at))
      return { title: title(key), note: `${rows.length} record${rows.length === 1 ? '' : 's'}`, rows: rows.map((r) => r.cells) }
    })
  return { groups, flagged }
}

export async function gatherAeration(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const from = p.from || `${ctx.today.slice(0, 4)}-08-01`
  const to = p.to || ctx.today
  if (from > to) throw new Error('The start date is after the end date.')
  const toEnd = `${to}T23:59:59`
  const [readings, probes, tests, alerts, crops, bins, fields] = await Promise.all([
    fetchAll<AReading>((a, b) => supabase.from('bin_monitor_readings').select('bin_id, crop_id, read_on, initials, levels, notes').gte('read_on', from).lte('read_on', to).order('read_on').order('id').range(a, b)),
    fetchAll<AProbe>((a, b) => supabase.from('bin_readings').select('bin_id, reading_at, moisture_pct, temp_c, source').gte('reading_at', from).lte('reading_at', toEnd).order('reading_at').order('id').range(a, b)),
    fetchAll<ATest>((a, b) =>
      supabase.from('moisture_tests').select('bin_id, field_id, crop_id, tested_at, moisture_pct, temperature_c, grade, note').not('bin_id', 'is', null).gte('tested_at', from).lte('tested_at', toEnd).order('tested_at').order('id').range(a, b),
    ),
    fetchAll<AAlert>((a, b) => supabase.from('bin_air_alerts').select('bin_id, field_id, crop_id, moisture_pct, grade, raised_at, dismissed_at, dismissed_note').gte('raised_at', from).lte('raised_at', toEnd).order('raised_at').order('id').range(a, b)),
    fetchAll<ACrop>((a, b) => supabase.from('crops').select('id, name, moisture_dry_max').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('bins').select('id, name').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('fields').select('id, name').order('id').range(a, b)),
  ])
  if (!readings.length && !probes.length && !tests.length && !alerts.length) throw new Error(`No bin readings, tests or needs-air alerts between ${longDate(from)} and ${longDate(to)}.`)
  const binName = new Map(bins.map((b) => [b.id, b.name]))
  const fieldName = new Map(fields.map((f) => [f.id, f.name]))
  const r = aerationGroups({ readings, probes, tests, alerts }, crops, { bin: (id) => binName.get(id) ?? 'Bin', field: (id) => (id ? (fieldName.get(id) ?? null) : null) })
  const summary = [
    'Bin by bin: sensor-cable readings (the coolest and warmest level and the wettest, and what the readings say against the one before), probe readings, moisture tests of grain going in, and the needs-air alerts with how each was closed.',
    'When fans ran is not recorded in the app, so it is not on this report.',
  ]
  if (!readings.length) summary.push('No sensor-cable readings in this range: enter them on a bin’s page under Harvest → Bins.')
  return {
    title: 'Aeration and bin condition log',
    subtitle: `${longDate(from)} to ${longDate(to)}`,
    meta: [
      ['Bins', r.groups.filter((g) => !g.title.startsWith('No bin')).length],
      ['Cable readings', readings.length],
      ['Readings flagged', r.flagged],
      ['Needs-air alerts', alerts.length],
    ],
    summary,
    columns: AERATION_COLUMNS,
    groups: r.groups,
    groupLabel: 'Bin',
    orientation: 'landscape',
    filename: `Aeration and bin condition ${from} to ${to}`,
  }
}
