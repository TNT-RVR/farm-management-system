import { supabase } from '@/lib/supabase'
import { farmTz } from '@/lib/farm-context'
import { compareFieldNames } from '@/lib/queries'
import { FN_FAULT_STATES } from '@/lib/fieldnet'
import { conv, depthValue, type UnitSystem } from '@/lib/units'
import { fetchAll, num, pick, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * Pivot operation log: every pass FieldNET recorded on each pivot over a
 * season — when it started and ended, the arc it swept, the depth it was set
 * to, how it ended — and the fault alerts the app sent about that pivot.
 *
 * A pass "stopped short" is FieldNET's own `completed = false`; a pass that
 * ended in one of the alarm states the map paints red (fieldnet.ts
 * FN_FAULT_STATES) is a fault even when FieldNET calls it complete. Fault
 * alerts are the app's notifications (one per person, so the same alert is
 * counted once); one that came while a pass was running, or within three
 * hours of it stopping, is written on that pass, and one with no pass near it
 * gets its own line — a fault on a pivot that never got going.
 */

export type PassRow = {
  id: string
  fieldnet_id: string
  field_id: string | null
  started_at: string
  ended_at: string | null
  start_deg: unknown
  end_deg: unknown
  swept_deg: unknown
  direction: string | null
  depth_mm: unknown
  end_status: string | null
  completed: boolean | null
}
export type SystemRow = { fieldnet_id: string; name: string | null; field_id: string | null }
export type FaultAlert = { link: string | null; body: string | null; created_at: string }

/** Matched to a pass when it came in while the pass ran, or this long after it stopped. */
const ALERT_AFTER_MS = 3 * 3_600_000

/** "2026-10-01 10:35" on the farm's clock. */
export function localStamp(iso: string, tz: string): string {
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-CA', { timeZone: tz })
  const time = d.toLocaleTimeString('en-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return `${day} ${time}`
}

const words = (s: string | null | undefined) => (s ?? '').replace(/-/g, ' ')

/** The pivot status an alert reports: `… is reporting "alignment fault".` */
export const alertStatus = (body: string | null) => /reporting "([^"]+)"/.exec(body ?? '')?.[1] ?? 'fault'

/** One alert per pivot and minute: the app writes a copy for everyone it tells. */
export function dedupeAlerts(alerts: FaultAlert[]): FaultAlert[] {
  const seen = new Map<string, FaultAlert>()
  for (const a of alerts) {
    const key = `${a.link ?? ''}|${a.created_at.slice(0, 16)}`
    if (!seen.has(key)) seen.set(key, a)
  }
  return [...seen.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
}

export const isFaultEnd = (p: Pick<PassRow, 'completed' | 'end_status'>) => p.completed === false || (p.end_status != null && FN_FAULT_STATES.has(p.end_status))

export function pivotColumns(u: UnitSystem) {
  return [
    { label: 'Started' },
    { label: 'Ended' },
    { label: 'Hours', decimals: 1 },
    { label: 'From (°)', decimals: 0 },
    { label: 'To (°)', decimals: 0 },
    { label: 'Swept (°)', decimals: 0 },
    { label: 'Direction' },
    { label: `Depth (${conv.depthUnit(u)})`, decimals: u === 'metric' ? 1 : 2 },
    { label: 'How it ended' },
    { label: 'Fault alert' },
  ]
}

export function pivotLogGroups(o: {
  passes: PassRow[]
  systems: SystemRow[]
  fieldNames: Map<string, string>
  alerts: FaultAlert[]
  tz: string
  units: UnitSystem
}): { groups: ReportGroup[]; passes: number; hours: number; faults: number; alerts: number } {
  const system = new Map(o.systems.map((s) => [s.fieldnet_id, s]))
  const fieldOfAlert = (a: FaultAlert) => /^\/fields\/([0-9a-f-]{36})/.exec(a.link ?? '')?.[1] ?? null
  const alerts = dedupeAlerts(o.alerts)

  // A pivot is its field where FieldNET has one, else the FieldNET system.
  type Pivot = { key: string; name: string; sort: string; passes: PassRow[]; alerts: FaultAlert[] }
  const pivots = new Map<string, Pivot>()
  const pivotFor = (fieldId: string | null, fieldnetId: string | null): Pivot => {
    const key = fieldId ?? `fn:${fieldnetId}`
    let p = pivots.get(key)
    if (!p) {
      const sys = fieldnetId ? system.get(fieldnetId) : o.systems.find((s) => s.field_id === fieldId)
      const field = fieldId ? o.fieldNames.get(fieldId) : undefined
      const name = sys?.name && field ? `${sys.name} (field ${field})` : (sys?.name ?? field ?? 'Pivot')
      p = { key, name, sort: field ?? sys?.name ?? '', passes: [], alerts: [] }
      pivots.set(key, p)
    }
    return p
  }
  for (const p of o.passes) pivotFor(p.field_id ?? system.get(p.fieldnet_id)?.field_id ?? null, p.fieldnet_id).passes.push(p)
  for (const a of alerts) {
    const f = fieldOfAlert(a)
    if (f) pivotFor(f, null).alerts.push(a)
  }

  const depth = (mm: number | null) => (mm == null ? null : depthValue(mm, o.units))
  let hoursAll = 0
  let faultsAll = 0
  const groups = [...pivots.values()]
    .sort((a, b) => compareFieldNames(a.sort, b.sort))
    .map((pv): ReportGroup => {
      const passes = [...pv.passes].sort((a, b) => a.started_at.localeCompare(b.started_at))
      const used = new Set<FaultAlert>()
      const rows: { at: string; cells: Cell[] }[] = passes.map((p) => {
        const start = Date.parse(p.started_at)
        const end = p.ended_at ? Date.parse(p.ended_at) : null
        const near = pv.alerts.filter((a) => {
          const t = Date.parse(a.created_at)
          return t >= start && t <= (end ?? Date.now()) + ALERT_AFTER_MS
        })
        near.forEach((a) => used.add(a))
        const fault = isFaultEnd(p)
        const ended = p.ended_at ? `${words(p.end_status) || 'ended'}${p.completed === false ? ' — stopped short' : ''}` : 'still running'
        return {
          at: p.started_at,
          cells: [
            localStamp(p.started_at, o.tz),
            p.ended_at ? localStamp(p.ended_at, o.tz) : null,
            end != null ? (end - start) / 3_600_000 : null,
            num(p.start_deg),
            num(p.end_deg),
            num(p.swept_deg),
            p.direction,
            depth(num(p.depth_mm)),
            fault && p.ended_at ? `${ended} (fault)` : ended,
            near.length ? near.map((a) => `${localStamp(a.created_at, o.tz).slice(5)} ${alertStatus(a.body)}`).join('; ') : null,
          ],
        }
      })
      // Alerts with no pass near them: the pivot faulted without getting going.
      for (const a of pv.alerts.filter((x) => !used.has(x))) {
        rows.push({ at: a.created_at, cells: [localStamp(a.created_at, o.tz), null, null, null, null, null, null, null, 'fault alert with no pass near it', `${localStamp(a.created_at, o.tz).slice(5)} ${alertStatus(a.body)}`] })
      }
      rows.sort((a, b) => a.at.localeCompare(b.at))
      const hours = passes.reduce((s, p) => s + (p.ended_at ? (Date.parse(p.ended_at) - Date.parse(p.started_at)) / 3_600_000 : 0), 0)
      const swept = passes.reduce((s, p) => s + (num(p.swept_deg) ?? 0), 0)
      const faults = passes.filter((p) => p.ended_at && isFaultEnd(p)).length
      hoursAll += hours
      faultsAll += faults
      return {
        title: pv.name,
        note: `${passes.length} pass${passes.length === 1 ? '' : 'es'}, ${Math.round(hours).toLocaleString('en-CA')} h run, ${(swept / 360).toFixed(1)} times round${faults ? `, ${faults} ended on a fault` : ''}${pv.alerts.length ? `, ${pv.alerts.length} fault alert${pv.alerts.length === 1 ? '' : 's'}` : ''}.`,
        rows: rows.map((r) => r.cells),
        totals: [`${passes.length} passes`, null, hours, null, null, swept, null, null, faults ? `${faults} ended on a fault` : null, pv.alerts.length ? `${pv.alerts.length} alert${pv.alerts.length === 1 ? '' : 's'}` : null],
      }
    })
  return { groups, passes: o.passes.length, hours: hoursAll, faults: faultsAll, alerts: alerts.filter((a) => fieldOfAlert(a)).length }
}

export async function gatherPivotLog(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const fieldId = pick(p, 'field')
  // The season in UTC with a day either side; the farm's clock is close enough
  // for a pass that starts on New Year's Eve, which no pivot does.
  const from = `${year}-01-01`
  const to = `${year + 1}-01-01`
  const [passes, systems, fields, alerts] = await Promise.all([
    fetchAll<PassRow>((a, b) => {
      let q = supabase
        .from('fieldnet_passes')
        .select('id, fieldnet_id, field_id, started_at, ended_at, start_deg, end_deg, swept_deg, direction, depth_mm, end_status, completed')
        .gte('started_at', from)
        .lt('started_at', to)
      if (fieldId) q = q.eq('field_id', fieldId)
      return q.order('started_at').order('id').range(a, b)
    }),
    fetchAll<SystemRow>((a, b) => supabase.from('fieldnet_systems').select('fieldnet_id, name, field_id').order('fieldnet_id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('fields').select('id, name').order('id').range(a, b)),
    // The person's own copies: each alert goes to everyone it tells, and a
    // person reads only theirs.
    fetchAll<FaultAlert>((a, b) => {
      let q = supabase.from('notifications').select('link, body, created_at').eq('kind', 'fieldnet_fault').gte('created_at', from).lt('created_at', to)
      if (fieldId) q = q.eq('link', `/fields/${fieldId}`)
      return q.order('created_at').order('id').range(a, b)
    }),
  ])
  const fieldNames = new Map(fields.map((f) => [f.id, f.name]))
  const r = pivotLogGroups({ passes, systems, fieldNames, alerts, tz: farmTz(), units: ctx.units })
  const which = fieldId ? (fieldNames.get(fieldId) ?? 'one field') : 'All pivots'
  if (!r.groups.length) throw new Error(`FieldNET recorded no passes${fieldId ? ` on ${which}` : ''} in ${year}.`)
  return {
    title: 'Pivot operation log',
    subtitle: `${year} season · ${which}`,
    meta: [
      ['Pivots', r.groups.length],
      ['Passes', r.passes],
      ['Hours run', `${Math.round(r.hours).toLocaleString('en-CA')} h`],
      ['Ended on a fault', r.faults],
      ['Fault alerts', r.alerts],
    ],
    summary: [
      'Every pass FieldNET recorded: start and end on the farm’s clock, the arc from and to, the degrees swept (over 360 is more than once round), and the depth the pivot was set to apply.',
      '“Stopped short” is FieldNET’s own flag; “(fault)” marks a pass that ended in an alarm state. Fault alerts are the ones the app sent you; one sent while a pass ran, or within three hours of it stopping, is written on that pass.',
      'Pivots without a FieldNET panel are not here: their water is logged by hand on Soil moisture.',
    ],
    columns: pivotColumns(ctx.units),
    groups: r.groups,
    groupLabel: 'Pivot',
    totals: [`${r.passes} passes`, null, r.hours, null, null, null, null, null, r.faults ? `${r.faults} ended on a fault` : null, r.alerts ? `${r.alerts} alerts` : null],
    orientation: 'landscape',
    filename: `Pivot operation log ${year}${fieldId ? ` ${which}` : ''}`,
  }
}
