import { supabase } from '@/lib/supabase'
import { farmDistrict } from '@/lib/farm-context'
import { compareFieldNames } from '@/lib/queries'
import { pivotShare, type PoolLicence, type PoolPivot } from '@/lib/licence-pools'
import { allocationRow, pivotAllotment, smridAllotmentFor, type PivotRow, type YearAllotment } from '@/lib/water-allocation'
import { fetchAll, num, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * Water used against water allowed, per pivot, grouped by where the water
 * comes from: each river licence as one bucket (its volume, the pivots on
 * it and each one's share), then the irrigation district's canal pivots
 * against the year's allotment. Used is the gross depth logged (FieldNET or
 * by hand) — what came out of the river or the canal — the same figure the
 * Allocation and Water rights panels use; shares are worked out the way
 * Pivot Information does (licence-pools.ts pivotShare).
 */

export type WaterPivot = PivotRow & { licence_note: string | null; fields: { name: string; active?: boolean | null } | null }
export type WaterEvent = { field_id: string; date: string; gross_mm: unknown; net_mm: unknown }
export type WaterLicence = { id: string; licence_number: string | null; volume: unknown; source: string | null; status: string | null; holder: string | null }

export const WATER_COLUMNS = [
  { label: 'Field' },
  { label: 'Irrigated (ac)', decimals: 1 },
  { label: 'Applied (in)', decimals: 1 },
  { label: 'Applied (ac-ft)', decimals: 1 },
  { label: 'Allowed (in)', decimals: 1 },
  { label: 'Allowed (ac-ft)', decimals: 1 },
  { label: 'Used' },
  { label: 'Allowed from' },
]

const pct = (used: number | null, allowed: number | null) => (used == null || allowed == null || !(allowed > 0) ? null : `${Math.round((used / allowed) * 100)}%`)
const SOURCE: Record<string, string> = { oldman_river: 'Oldman River', south_saskatchewan_river: 'South Saskatchewan River' }

/** The groups: licences first (by number), then the canal, then pivots with nothing on file. */
export function waterUseGroups(o: {
  pivots: WaterPivot[]
  licences: WaterLicence[]
  events: WaterEvent[]
  allotments: YearAllotment[]
  year: number
  today: string
  district: string
}): { groups: ReportGroup[]; totals: { acres: number; usedAf: number }; smrid: ReturnType<typeof smridAllotmentFor> } {
  const smrid = smridAllotmentFor(o.allotments, o.year)
  const active = o.pivots.filter((p) => p.fields?.active !== false)
  const evOf = new Map<string, { date: string; gross_mm: number | null; net_mm: number | null }[]>()
  for (const e of o.events) evOf.set(e.field_id, [...(evOf.get(e.field_id) ?? []), { date: e.date, gross_mm: num(e.gross_mm), net_mm: num(e.net_mm) }])
  const onCanal = (p: WaterPivot) => p.smrid_area != null || p.water_source === 'smrid'
  const pool: PoolPivot[] = active.map((p) => ({
    fieldId: p.field_id,
    name: p.fields?.name ?? 'Pivot',
    acres: num(p.acres_irrigated),
    licenceId: p.water_licence_id,
    shareAf: num(p.acre_feet_allotment),
    pending: /^Pending/i.test(p.licence_note ?? ''),
  }))
  const lic: PoolLicence[] = o.licences.map((l) => ({ id: l.id, number: l.licence_number ?? '', source: l.source, status: l.status, holder: l.holder, volumeAf: num(l.volume) }))

  type Line = { name: string; cells: Cell[]; acres: number; usedAf: number; allowedAf: number | null }
  const lineFor = (p: WaterPivot): Line => {
    const a = allocationRow(pivotAllotment(p, smrid.inches, o.district), evOf.get(p.field_id) ?? [], o.today, `${o.year}-10-31`)
    const pp = pool.find((x) => x.fieldId === p.field_id)!
    const canal = onCanal(p)
    const share = pivotShare({ ...pp, onCanal: canal }, pool, lic, smrid.inches, o.district)
    const acres = a.acres ?? 0
    const usedAf = a.usedAcreFeet ?? 0
    // A canal pivot is allowed the district's inches (or its own override);
    // a river pivot its share of the licence.
    const allowedIn = canal ? a.allottedInches : share.af != null && acres > 0 ? (share.af * 12) / acres : null
    const allowedAf = canal ? (a.allottedInches != null && acres > 0 ? (a.allottedInches * acres) / 12 : null) : share.af
    const from = canal
      ? a.allottedFrom === 'override'
        ? 'This pivot’s own allotment override'
        : a.allottedInches != null
          ? `${o.district} allotment`
          : `No ${o.district} allotment on file`
      : share.note
    return {
      name: a.name,
      acres,
      usedAf,
      allowedAf,
      cells: [a.name, a.acres, a.usedInches, a.usedAcreFeet, allowedIn, allowedAf, pct(a.usedAcreFeet, allowedAf), from],
    }
  }
  const groups: ReportGroup[] = []
  const total = (lines: Line[], label: string, allowedAf: number | null): Cell[] => {
    const acres = lines.reduce((s, l) => s + l.acres, 0)
    const used = lines.reduce((s, l) => s + l.usedAf, 0)
    return [label, acres, acres > 0 ? (used * 12) / acres : null, used, allowedAf != null && acres > 0 ? (allowedAf * 12) / acres : null, allowedAf, pct(used, allowedAf), null]
  }
  const sorted = (ps: WaterPivot[]) => [...ps].sort((a, b) => compareFieldNames(a.fields?.name ?? '', b.fields?.name ?? ''))
  const done = new Set<string>()

  for (const l of [...o.licences].sort((a, b) => (a.licence_number ?? '').localeCompare(b.licence_number ?? ''))) {
    const on = sorted(active.filter((p) => p.water_licence_id === l.id && !onCanal(p)))
    if (!on.length) continue
    on.forEach((p) => done.add(p.field_id))
    const lines = on.map(lineFor)
    const vol = num(l.volume)
    groups.push({
      title: `Licence ${l.licence_number ?? '(no number)'}${l.source ? ` · ${SOURCE[l.source] ?? l.source}` : ''}`,
      note: vol != null ? `${vol.toLocaleString('en-CA')} ac-ft a year, shared by ${on.length} pivot${on.length === 1 ? '' : 's'}.` : 'The licence’s volume is not on file, so its use cannot be judged.',
      rows: lines.map((x) => x.cells),
      totals: total(lines, 'Licence total', vol),
    })
  }
  const canal = sorted(active.filter((p) => onCanal(p)))
  if (canal.length) {
    canal.forEach((p) => done.add(p.field_id))
    const lines = canal.map(lineFor)
    const allowed = lines.every((x) => x.allowedAf != null) ? lines.reduce((s, x) => s + (x.allowedAf ?? 0), 0) : null
    groups.push({
      title: `${o.district} canal`,
      note:
        smrid.inches == null
          ? `No ${o.district} allotment on file for ${o.year}.`
          : `${o.year} allotment ${smrid.inches} in${smrid.contract != null ? ` of the ${smrid.contract} in contract` : ''}${smrid.setFor !== o.year ? ` (not set for ${o.year}; ${smrid.setFor}’s figure)` : ''}.`,
      rows: lines.map((x) => x.cells),
      totals: total(lines, `${o.district} total`, allowed),
    })
  }
  const rest = sorted(active.filter((p) => !done.has(p.field_id)))
  if (rest.length) {
    const lines = rest.map(lineFor)
    groups.push({ title: 'No licence or allotment on file', note: 'Set the water source and licence on Pivot Information.', rows: lines.map((x) => x.cells), totals: total(lines, 'Total', null) })
  }
  const all = active.map((p) => ({ acres: num(p.acres_irrigated) ?? 0, used: ((evOf.get(p.field_id) ?? []).reduce((s, e) => s + (e.gross_mm ?? e.net_mm ?? 0), 0) / 25.4) * (num(p.acres_irrigated) ?? 0) / 12 }))
  return { groups, totals: { acres: all.reduce((s, x) => s + x.acres, 0), usedAf: all.reduce((s, x) => s + x.used, 0) }, smrid }
}

export async function gatherWaterUse(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const [pivots, licences, events, allotments] = await Promise.all([
    fetchAll<WaterPivot>((a, b) =>
      supabase
        .from('field_pivots')
        .select('field_id, acres_irrigated, alloted_inches, acre_feet_allotment, on_river, smrid_area, water_licence_id, water_source, licence_note, fields(name, active)')
        .eq('not_used', false)
        .order('id')
        .range(a, b),
    ),
    fetchAll<WaterLicence>((a, b) => supabase.from('water_licences').select('id, licence_number, volume, source, status, holder').order('id').range(a, b)),
    fetchAll<WaterEvent>((a, b) => supabase.from('irrigation_events').select('field_id, date, gross_mm, net_mm').gte('date', `${year}-01-01`).lte('date', `${year}-12-31`).order('id').range(a, b)),
    fetchAll<YearAllotment>((a, b) => supabase.from('water_allotments').select('year, inches, contract_inches').eq('source', 'smrid').order('year').range(a, b)),
  ])
  const district = farmDistrict()
  const r = waterUseGroups({ pivots, licences, events, allotments, year, today: ctx.today, district })
  if (!r.groups.length) throw new Error('No pivots are set up yet (Pivot Information).')
  return {
    title: 'Water use against allotment and licence',
    subtitle: `${year} season`,
    meta: [
      ['Pivots', r.groups.reduce((n, g) => n + g.rows.length, 0)],
      ['Irrigated', `${Math.round(r.totals.acres).toLocaleString('en-CA')} ac`],
      ['Applied', `${Math.round(r.totals.usedAf).toLocaleString('en-CA')} ac-ft`],
      [`${district} allotment`, r.smrid.inches == null ? 'not set' : `${r.smrid.inches} in`],
      ['Irrigation events', events.length],
    ],
    summary: [
      'Applied is the gross depth logged on each pivot (FieldNET, or by hand) — what came out of the river or the canal, not what the crop kept. Acre-feet are inches over the pivot’s irrigated acres.',
      'A licence is one bucket: its volume split at equal depth over the pivots on it unless a share is typed on Pivot Information.',
    ],
    columns: WATER_COLUMNS,
    groups: r.groups,
    groupLabel: 'Water source',
    totals: ['All pivots', r.totals.acres, r.totals.acres > 0 ? (r.totals.usedAf * 12) / r.totals.acres : null, r.totals.usedAf, null, null, null, null],
    filename: `Water use ${year}`,
  }
}
