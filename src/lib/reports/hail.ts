import { supabase } from '@/lib/supabase'
import { compareFieldNames } from '@/lib/queries'
import type { HailBand } from '@/lib/hail-report'
import { fetchAll, fieldLabel, num, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * Every hail on every field in a year: the day somebody marked it on the
 * field, and AFSC's inspection where one came in — the adjuster, the acres
 * looked at, the loss they assessed and how it fell across AFSC's damage
 * bands. An inspection applied to a field leaves a hail mark of its own on
 * the damage date, so the two are one row, not two.
 *
 * AFSC's report states the loss, not the cheque: nothing in the app holds
 * what was paid, so the report says so rather than guessing a payout.
 */

export const HAIL_COLUMNS = [
  { label: 'Date' },
  { label: 'Crop' },
  { label: 'Inspection' },
  { label: 'Adjuster' },
  { label: 'Acres', decimals: 1 },
  { label: 'Loss (%)', decimals: 0 },
  { label: 'Acres lost', decimals: 1 },
  { label: 'Damage bands' },
  { label: 'Reported' },
  { label: 'Note' },
]

export type HailMark = { field_id: string; event_date: string; notes: string | null; loss_pct?: number | null; acres?: number | null }
export type Inspection = {
  inspection_number: string
  field_id: string | null
  land_location: string
  crop_label: string | null
  damage_date: string | null
  report_date: string | null
  loss_notice_date: string | null
  adjuster: string | null
  acres: unknown
  loss_pct: unknown
  bands: HailBand[] | null
  status: string
}

/** AFSC's bands with acres in them: "10% - 70%: 125 ac at 17%". */
export function bandText(bands: HailBand[] | null): string | null {
  const used = (bands ?? []).filter((b) => num(b.acres) != null && Number(b.acres) > 0)
  if (!used.length) return null
  return used.map((b) => `${b.band}: ${Number(b.acres).toLocaleString('en-CA')} ac${b.lossPct != null ? ` at ${b.lossPct}%` : ''}`).join('; ')
}

/**
 * The year's hail, a group per field (and one for inspections not yet placed
 * on a field), oldest first. A mark on the inspection's damage date is that
 * inspection; any other mark is hail nobody has had inspected (yet).
 */
export function hailGroups(marks: HailMark[], inspections: Inspection[], fieldName: (id: string) => string | null, cropOf: (fieldId: string) => string | null): { groups: ReportGroup[]; inspected: number; marked: number; lostAcres: number } {
  const byField = new Map<string, { at: string; cells: Cell[] }[]>()
  const add = (key: string, at: string, cells: Cell[]) => byField.set(key, [...(byField.get(key) ?? []), { at, cells }])
  const live = inspections.filter((i) => i.status !== 'rejected')
  let lostAcres = 0
  for (const i of live) {
    const acres = num(i.acres)
    const loss = num(i.loss_pct)
    const lost = acres != null && loss != null ? (acres * loss) / 100 : null
    lostAcres += lost ?? 0
    const key = i.field_id ?? ''
    const reported = [i.loss_notice_date ? `notice ${i.loss_notice_date}` : null, i.report_date ? `report ${i.report_date}` : null].filter(Boolean).join(', ')
    add(key, i.damage_date ?? '', [
      i.damage_date,
      i.crop_label ?? (i.field_id ? cropOf(i.field_id) : null),
      i.inspection_number,
      i.adjuster,
      acres,
      loss,
      lost,
      bandText(i.bands),
      reported || null,
      [i.field_id ? null : i.land_location, i.status === 'pending' ? 'waiting to be checked on Hail' : null].filter(Boolean).join(' · ') || null,
    ])
  }
  const inspectedOn = new Set(live.filter((i) => i.field_id && i.damage_date).map((i) => `${i.field_id}:${i.damage_date}`))
  let marked = 0
  for (const m of marks) {
    if (inspectedOn.has(`${m.field_id}:${m.event_date}`)) continue
    marked++
    // A hand entry's own loss % and acres (Sam, 7 Oct 2026); acres lost follows from them.
    const acres = m.acres == null ? null : Number(m.acres)
    const loss = m.loss_pct == null ? null : Number(m.loss_pct)
    add(m.field_id, m.event_date, [m.event_date, cropOf(m.field_id), null, null, acres, loss, acres != null && loss != null ? (acres * loss) / 100 : null, null, null, m.notes ?? 'marked on the field; no AFSC inspection on file'])
  }
  const groups: ReportGroup[] = [...byField.entries()]
    .sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : compareFieldNames(fieldName(a[0]) ?? '', fieldName(b[0]) ?? '')))
    .map(([key, rows]) => {
      rows.sort((a, b) => a.at.localeCompare(b.at))
      const lost = rows.reduce((s, r) => s + (typeof r.cells[6] === 'number' ? r.cells[6] : 0), 0)
      return {
        title: key ? fieldLabel(fieldName(key) ?? 'A field') : 'Not placed on a field yet',
        note: `${rows.length} hail${rows.length === 1 ? '' : 's'}${lost > 0 ? ` · ${lost.toLocaleString('en-CA', { maximumFractionDigits: 1 })} acres' worth lost` : ''}`,
        rows: rows.map((r) => r.cells),
      }
    })
  return { groups, inspected: live.length, marked, lostAcres }
}

export async function gatherHail(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const [marks, inspections, fields, plans, crops] = await Promise.all([
    fetchAll<HailMark>((a, b) => supabase.from('field_hail_events').select('field_id, event_date, notes, loss_pct, acres').eq('crop_year', year).order('id').range(a, b)),
    fetchAll<Inspection>((a, b) =>
      supabase
        .from('hail_inspections')
        .select('inspection_number, field_id, land_location, crop_label, damage_date, report_date, loss_notice_date, adjuster, acres, loss_pct, bands, status')
        .gte('damage_date', `${year}-01-01`)
        .lte('damage_date', `${year}-12-31`)
        .order('id')
        .range(a, b),
    ),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('fields').select('id, name').order('id').range(a, b)),
    fetchAll<{ field_id: string; crop_id: string }>((a, b) => supabase.from('crop_plans').select('field_id, crop_id').eq('crop_year', year).order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('crops').select('id, name').order('id').range(a, b)),
  ])
  const nameOf = new Map(fields.map((f) => [f.id, f.name]))
  const cropName = new Map(crops.map((c) => [c.id, c.name]))
  const planCrop = new Map(plans.map((x) => [x.field_id, cropName.get(x.crop_id) ?? null]))
  const r = hailGroups(marks, inspections, (id) => nameOf.get(id) ?? null, (id) => planCrop.get(id) ?? null)
  if (!r.groups.length) throw new Error(`No hail recorded in ${year}.`)
  return {
    title: 'Hail damage record',
    subtitle: `${year}`,
    meta: [
      ['Fields hit', r.groups.filter((g) => g.title !== 'Not placed on a field yet').length],
      ['AFSC inspections', r.inspected],
      ['Marked, not inspected', r.marked],
      ['Acres lost (acres × loss)', `${r.lostAcres.toLocaleString('en-CA', { maximumFractionDigits: 1 })} ac`],
    ],
    summary: [
      'Every hail marked on a field this year, with AFSC’s inspection where one came in: the adjuster, the acres inspected, the loss assessed and how it fell across AFSC’s damage bands. Acres lost is acres × loss, the acres’ worth of crop the hail took.',
      'The inspection reports state the loss, not the payment: what AFSC paid is not recorded in the app, so it is not on this report.',
    ],
    columns: HAIL_COLUMNS,
    groups: r.groups,
    groupLabel: 'Field',
    orientation: 'landscape',
    filename: `Hail damage record ${year}`,
  }
}
