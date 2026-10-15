import { supabase } from '@/lib/supabase'
import { categoryRank, type Equipment, type ServicePlanRow } from '@/lib/equipment'
import { dueLabel, dueRank, dueState } from '@/lib/maintenance'
import { warrantyStatus } from '@/lib/warranty'
import { fetchAll, num, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * The fleet for a year: each machine's engine hours (Deere's modem reading,
 * where it has one), its service plans against those hours and the calendar
 * (maintenance.ts dueState — Prairie Creek's own intervals, never Deere's
 * advice), the services logged and what they cost, Deere's diagnostic alerts,
 * and the warranty (warranty.ts, whichever of the date or the hours runs out
 * first). Repair cost is the cost typed on each logged service: the app has
 * no other record of what a machine cost to fix.
 */

export type ServiceLog = { equipment_id: string; done_on: string; cost: unknown }
export type MachineAlert = { equipment_jd_id: string; severity: string | null; occurred_at: string | null; ignored: boolean }

export const EQUIPMENT_COLUMNS = [
  { label: 'Machine' },
  { label: 'Make and model' },
  { label: 'Engine hours', decimals: 0 },
  { label: 'Hours read' },
  { label: 'Service plans', decimals: 0 },
  { label: 'Service due' },
  { label: 'Services logged', decimals: 0 },
  { label: 'Service and repair cost', money: true, decimals: 0 },
  { label: 'Deere alerts' },
  { label: 'Warranty' },
]

const CATEGORY_TITLE: Record<string, string> = { machine: 'Machines', implement: 'Implements', technology: 'Technology', other: 'Other' }

/** The plans that need doing, worst first, or why none can be judged. */
export function serviceDue(plans: ServicePlanRow[], hours: number | null, now: Date): { text: string | null; urgent: number } {
  const active = plans.filter((p) => p.active)
  if (!active.length) return { text: null, urgent: 0 }
  const dues = active.map((p) => ({ p, d: dueState({ ...p, interval_hours: num(p.interval_hours), interval_months: num(p.interval_months), last_done_hours: num(p.last_done_hours) }, hours, now) }))
  const urgent = dues.filter((x) => x.d.state === 'overdue' || x.d.state === 'due-soon').sort((a, b) => dueRank(a.d.state) - dueRank(b.d.state))
  if (urgent.length) return { text: urgent.map((x) => `${x.p.name}: ${dueLabel(x.d)}`).join('; '), urgent: urgent.length }
  const unknown = dues.filter((x) => x.d.state === 'unknown').length
  if (unknown === dues.length) return { text: hours == null ? 'no engine hours reported, and no service logged' : 'no service logged yet, so nothing to measure from', urgent: 0 }
  return { text: `none due${unknown ? ` (${unknown} not logged yet)` : ''}`, urgent: 0 }
}

export function equipmentGroups(o: {
  machines: Equipment[]
  plans: ServicePlanRow[]
  logs: ServiceLog[]
  alerts: MachineAlert[]
  year: number
  now: Date
}): { groups: ReportGroup[]; cost: number; services: number; due: number } {
  const inYear = (d: string | null) => !!d && d.slice(0, 4) === String(o.year)
  let cost = 0
  let services = 0
  let due = 0
  const byCat = new Map<string, Cell[][]>()
  const sorted = [...o.machines].sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || (a.name ?? '').localeCompare(b.name ?? ''))
  for (const m of sorted) {
    const hours = num(m.engine_hours)
    const plans = o.plans.filter((p) => p.equipment_id === m.id)
    const logs = o.logs.filter((l) => l.equipment_id === m.id && inYear(l.done_on))
    const spent = logs.reduce((s, l) => s + (num(l.cost) ?? 0), 0)
    const alerts = o.alerts.filter((a) => a.equipment_jd_id === m.jd_id && !a.ignored && inYear(a.occurred_at))
    const sev = (s: string) => alerts.filter((a) => (a.severity ?? '').toUpperCase() === s).length
    const alertText = alerts.length ? [sev('HIGH') && `${sev('HIGH')} high`, sev('MEDIUM') && `${sev('MEDIUM')} medium`, alerts.length - sev('HIGH') - sev('MEDIUM') && `${alerts.length - sev('HIGH') - sev('MEDIUM')} other`].filter(Boolean).join(', ') : null
    const service = serviceDue(plans, hours, o.now)
    due += service.urgent
    const w = warrantyStatus({ warranty_expires_on: m.warranty_expires_on, warranty_hours: m.warranty_hours, engine_hours: hours }, o.now)
    cost += spent
    services += logs.length
    const cat = (m.category ?? 'other').toLowerCase()
    byCat.set(cat, [
      ...(byCat.get(cat) ?? []),
      [
        m.name ?? 'Unnamed machine',
        [m.make, m.model].filter(Boolean).join(' ') || null,
        hours,
        m.engine_hours_at ? m.engine_hours_at.slice(0, 10) : null,
        plans.filter((p) => p.active).length || null,
        service.text,
        logs.length || null,
        logs.length ? spent : null,
        alertText,
        w.label ?? (m.warranty_expires_on || m.warranty_hours ? null : 'not recorded'),
      ],
    ])
  }
  const groups = [...byCat].map(([cat, rows]) => ({ title: CATEGORY_TITLE[cat] ?? cat, rows }))
  return { groups, cost, services, due }
}

export async function gatherEquipment(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const [machines, plans, logs, alerts] = await Promise.all([
    fetchAll<Equipment>((a, b) => supabase.from('jd_equipment').select('*').eq('archived', false).order('name').order('id').range(a, b)),
    fetchAll<ServicePlanRow>((a, b) => supabase.from('equipment_service_plans').select('*').order('id').range(a, b)),
    fetchAll<ServiceLog>((a, b) => supabase.from('equipment_service_log').select('equipment_id, done_on, cost').gte('done_on', `${year}-01-01`).lte('done_on', `${year}-12-31`).order('id').range(a, b)),
    fetchAll<MachineAlert>((a, b) =>
      supabase.from('jd_equipment_alerts').select('equipment_jd_id, severity, occurred_at, ignored').gte('occurred_at', `${year}-01-01`).lt('occurred_at', `${year + 1}-01-01`).order('id').range(a, b),
    ),
  ])
  if (!machines.length) throw new Error('No machines in the fleet yet (Equipment → sync from Deere).')
  const [y, m, d] = ctx.today.split('-').map(Number)
  const r = equipmentGroups({ machines, plans, logs, alerts, year, now: new Date(y, m - 1, d, 12) })
  return {
    title: 'Equipment hours, service and repairs',
    subtitle: `${year} · ${machines.length} machines and implements`,
    meta: [
      ['Machines reporting hours', machines.filter((x) => x.engine_hours != null).length],
      ['Service plans', plans.filter((x) => x.active).length],
      ['Services due or overdue', r.due],
      ['Services logged', r.services],
      ['Service and repair cost', `$${Math.round(r.cost).toLocaleString('en-CA')}`],
    ],
    summary: [
      'Engine hours are Deere’s modem reading, on the date shown; a machine without a modem reports none. Service due is worked from the farm’s own intervals (hours, months, or whichever comes first) since the last logged service — a plan never logged cannot be measured, and says so.',
      `Services logged and their cost are those logged on the machine’s page with a done date in ${year}; that cost is the app’s only record of repairs. Deere alerts are the machine’s diagnostic alerts in ${year}, ignored ones left out.`,
      'Warranty is whichever runs out first, the date or the hours; “not recorded” says nothing about whether there is cover.',
    ],
    columns: EQUIPMENT_COLUMNS,
    groups: r.groups,
    groupLabel: 'Kind',
    orientation: 'landscape',
    filename: `Equipment service ${year}`,
  }
}
