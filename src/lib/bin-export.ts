import { supabase } from './supabase'
import type { Level } from './bin-monitor'
import { csvCell, tableReportToCsv, tableReportToPdf, type TableReport } from './table-report'

/**
 * Everything recorded against one bin over a date range, as a CSV or a PDF —
 * for a buyer, an insurer, a seed company, or the file.
 *
 * Gathered once into a plain report object; the two formats are just two ways
 * of printing it, so they cannot disagree about what happened.
 */

export type BinReport = {
  bin: { name: string; site: string | null; capacity_bu: number | null; usual_contents: string | null; notes: string | null }
  from: string
  to: string
  generatedAt: string
  sections: { title: string; note?: string; head: string[]; rows: (string | number | null)[][] }[]
}

const d = (s: string | null | undefined) => (s ? s.slice(0, 10) : '')
const r0 = (v: unknown) => (v == null || v === '' ? null : Math.round(Number(v)))
const r1 = (v: unknown) => (v == null || v === '' ? null : Math.round(Number(v) * 10) / 10)

/** The default range: the last six months, to today. */
export function defaultRange(today = new Date()): { from: string; to: string } {
  const to = today.toLocaleDateString('en-CA')
  const f = new Date(today)
  f.setMonth(f.getMonth() - 6)
  return { from: f.toLocaleDateString('en-CA'), to }
}

export async function gatherBinReport(binId: string, from: string, to: string): Promise<BinReport> {
  const toEnd = `${to}T23:59:59`
  const [bin, moves, loads, tests, monitor, alerts, crops, fields, sites] = await Promise.all([
    supabase.from('bins').select('*').eq('id', binId).single(),
    supabase.from('grain_movements').select('*').eq('bin_id', binId).gte('moved_at', from).lte('moved_at', to).order('moved_at'),
    supabase.from('bin_loads').select('*').or(`bin_id.eq.${binId},overflow_bin_id.eq.${binId}`).gte('loaded_on', from).lte('loaded_on', to).order('loaded_on'),
    supabase.from('moisture_tests').select('*').eq('bin_id', binId).gte('tested_at', from).lte('tested_at', toEnd).order('tested_at'),
    supabase.from('bin_monitor_readings').select('*').eq('bin_id', binId).gte('read_on', from).lte('read_on', to).order('read_on'),
    supabase.from('bin_air_alerts').select('*').eq('bin_id', binId).gte('raised_at', from).lte('raised_at', toEnd).order('raised_at'),
    supabase.from('crops').select('id, name'),
    supabase.from('fields').select('id, name'),
    supabase.from('delivery_sites').select('id, name'),
  ])
  for (const x of [bin, moves, loads, tests, monitor, alerts]) if (x.error) throw x.error
  // The tests taken in the field before it was hauled here (Sam, 26 Oct
  // 2026: the report was missing them). A test with no bin on it belongs to
  // this bin when its field and crop came in, and it was taken no later than
  // that field's last load here.
  const lastIn = new Map<string, string>()
  for (const l of loads.data ?? []) {
    if (!l.field_id || !l.crop_id) continue
    const k = `${l.field_id}:${l.crop_id}`
    if (!lastIn.has(k) || lastIn.get(k)! < l.loaded_on) lastIn.set(k, l.loaded_on)
  }
  const fieldIds = [...new Set([...lastIn.keys()].map((k) => k.split(':')[0]))]
  const fieldTests = fieldIds.length
    ? await supabase.from('moisture_tests').select('*').is('bin_id', null).in('field_id', fieldIds).gte('tested_at', from).lte('tested_at', toEnd).order('tested_at')
    : { data: [], error: null }
  if (fieldTests.error) throw fieldTests.error
  const testRows = [
    ...(tests.data ?? []).map((t) => ({ t, where: 'Bin' })),
    ...(fieldTests.data ?? [])
      .filter((t) => {
        const last = lastIn.get(`${t.field_id}:${t.crop_id}`)
        return last != null && d(t.tested_at) <= last
      })
      .map((t) => ({ t, where: 'Field' })),
  ].sort((a, b) => a.t.tested_at.localeCompare(b.t.tested_at))
  const crop = (id: string | null) => (crops.data ?? []).find((c) => c.id === id)?.name ?? ''
  const field = (id: string | null) => (fields.data ?? []).find((f) => f.id === id)?.name ?? ''
  const site = (id: string | null) => (sites.data ?? []).find((s) => s.id === id)?.name ?? ''
  const b = bin.data!

  const sections: BinReport['sections'] = []

  sections.push({
    title: 'Loads weighed in',
    head: ['Date', 'Field', 'Crop', 'Gross kg', 'Tare kg', 'Net kg', 'Bushels', 'Moisture %', 'Driver', 'Truck', 'Last from field', 'Note'],
    rows: (loads.data ?? []).map((l) => [
      l.loaded_on,
      field(l.field_id),
      crop(l.crop_id),
      l.entry_kind === 'weighed' ? r0(l.gross_kg) : null,
      l.entry_kind === 'weighed' ? r0(l.tare_kg) : null,
      r0(l.net_kg),
      r0(l.bushels),
      r1(l.moisture_pct),
      l.driver ?? '',
      [l.truck, l.trailer].filter(Boolean).join(' / '),
      l.last_from_field ? 'yes' : '',
      [l.note, l.delivery_site_id ? `to ${site(l.delivery_site_id)}` : null].filter(Boolean).join(' · '),
    ]),
  })

  sections.push({
    title: 'Grain movements',
    head: ['Date', 'Type', 'Crop', 'Field', 'Bushels', 'Ticket', 'Notes'],
    rows: (moves.data ?? []).map((m) => [m.moved_at, m.movement_type.replace(/_/g, ' '), crop(m.crop_id), field(m.field_id), r0(m.bushels), m.ticket_number?.startsWith('load:') ? '' : (m.ticket_number ?? ''), m.notes ?? '']),
  })

  sections.push({
    title: 'Moisture tests',
    head: ['Date', 'Taken in', 'Field', 'Crop', 'Moisture %', 'Grade', 'Temp °C'],
    rows: testRows.map(({ t, where }) => [d(t.tested_at), where, field(t.field_id), crop(t.crop_id), r1(t.moisture_pct), t.grade ?? '', r1(t.temperature_c)]),
  })

  const monitorRows = monitor.data ?? []
  const maxLevels = Math.max(0, ...monitorRows.map((m) => (Array.isArray(m.levels) ? m.levels.length : 0)))
  // Stored top-first (level 1 = top of the cable), printed bottom-first: 1 is
  // the bottom sensor, the way readings are typed in (Sam, 26 Oct 2026).
  sections.push({
    // "2 °C / moist." read as two degrees (Sam, 26 Oct 2026): the sensor is
    // named in words, and the units go in the note under the title.
    title: 'Sensor cable readings',
    note: 'Sensor 1 is the bottom of the cable. Each cell is temperature (°C) / grain moisture (%).',
    head: ['Date', 'By', ...Array.from({ length: maxLevels }, (_, i) => `Sensor ${i + 1}${i === 0 ? ' (bottom)' : ''}`), 'Notes'],
    rows: monitorRows.map((m) => {
      const lv = (Array.isArray(m.levels) ? m.levels : []) as unknown as Level[]
      const bottomFirst = [...lv].sort((a, b) => b.level - a.level)
      return [
        m.read_on,
        m.initials ?? '',
        ...Array.from({ length: maxLevels }, (_, i) => {
          const l = bottomFirst[i]
          if (!l) return ''
          // No RH: it isn't tracked (Sam, 26 Oct 2026).
          return [l.temp_c != null ? `${l.temp_c}°` : '–', l.moisture_pct != null ? `${l.moisture_pct}%` : '–'].join(' / ') + (l.air ? ' (air)' : '')
        }),
        m.notes ?? '',
      ]
    }),
  })

  // Only when one was raised: an empty table read as if there might have been.
  if (alerts.data?.length)
    sections.push({
      title: 'Needs-air alerts',
      head: ['Raised', 'Moisture %', 'Grade', 'Dismissed', 'Note'],
      rows: (alerts.data ?? []).map((a) => [d(a.raised_at), r1(a.moisture_pct), a.grade ?? '', d(a.dismissed_at), a.dismissed_note ?? '']),
    })

  return {
    bin: { name: b.name, site: b.site, capacity_bu: b.capacity_bu == null ? null : Number(b.capacity_bu), usual_contents: b.usual_contents, notes: b.notes_md },
    from,
    to,
    generatedAt: new Date().toLocaleString('en-CA'),
    sections,
  }
}

export { csvCell }

/** A bin's records as the shared report layout (both files are made from it). */
export function binReportTable(r: BinReport): TableReport {
  return {
    title: r.bin.name,
    subtitle: `Bin records · ${r.from} to ${r.to}`,
    meta: [
      ['Site', r.bin.site],
      ['Capacity (bu)', r.bin.capacity_bu],
      ['From', r.from],
      ['To', r.to],
      ['Generated', r.generatedAt],
    ],
    sections: r.sections,
  }
}

export const reportToCsv = (r: BinReport) => tableReportToCsv(binReportTable(r))
export const reportToPdf = (r: BinReport) => tableReportToPdf(binReportTable(r))
/** The spreadsheet: formatted Excel rather than a bare CSV (Sam, 26 Oct 2026). */
export const reportToXlsx = async (r: BinReport) => (await import('./table-report-xlsx')).tableReportToXlsx(binReportTable(r), { sheetName: 'Bin records' })
