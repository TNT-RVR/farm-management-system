import { supabase } from '@/lib/supabase'
import { farmTz } from '@/lib/farm-context'
import { fetchAll, longDate, pick, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * Audit log of edits: every insert, change and delete the database trigger
 * recorded (fn_audit → audit_log) over a date range, newest first, a group
 * per day. Who is the person signed in at the time; a change with no person
 * is the app's own syncs (Deere, FieldNET, the nightly jobs), which are left
 * out unless asked for — they are most of the log and none of the "who
 * changed this?". The filter runs in the database, a thousand rows a page.
 */

export type AuditRow = {
  changed_at: string
  table_name: string
  record_id: string | null
  action: string
  actor_id: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
}

/** The tables people edit by hand, for the picker. Any table can still be in "All tables". */
export const AUDIT_TABLES: { value: string; label: string }[] = [
  ['fields', 'Fields'],
  ['crop_plans', 'Crop plan'],
  ['crop_history', 'Crop history'],
  ['crops', 'Crops'],
  ['crop_prices', 'Crop prices'],
  ['crop_inputs', 'Crop inputs'],
  ['tasks', 'Tasks'],
  ['jd_products', 'Price book'],
  ['product_purchases', 'Invoice lines'],
  ['field_pivots', 'Pivots'],
  ['irrigation_events', 'Irrigation events'],
  ['bins', 'Bins'],
  ['bin_allocations', 'Bin allocations'],
  ['grain_movements', 'Grain movements'],
  ['moisture_tests', 'Moisture tests'],
  ['herd_counts', 'Herd counts'],
  ['cattle_sales', 'Cattle sales'],
  ['feed_record_lines', 'Feed records'],
  ['land_leases', 'Leases'],
  ['grants', 'Grants'],
  ['equipment_service_plans', 'Service plans'],
  ['users', 'Users'],
  ['water_licences', 'Water licences'],
  ['financial_entries', 'Financial entries'],
].map(([value, label]) => ({ value, label }))

/** Columns that change on every write and say nothing about the edit. */
const NOISE = new Set(['updated_at', 'synced_at', 'created_at', 'updated_by', 'computed_at', 'extracted_at'])

const short = (v: unknown, n = 40): string => {
  if (v == null) return '—'
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** "status: open → done; due_at: — → 2026-10-08", at most `max` characters. */
export function changeSummary(r: Pick<AuditRow, 'action' | 'old_values' | 'new_values'>, max = 260): string {
  const o = r.old_values ?? {}
  const n = r.new_values ?? {}
  let parts: string[]
  if (r.action === 'update') {
    parts = Object.keys(n)
      .filter((k) => !NOISE.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]))
      .map((k) => `${k}: ${short(o[k])} → ${short(n[k])}`)
    if (!parts.length) parts = ['no visible change']
  } else {
    const v = r.action === 'delete' ? o : n
    parts = Object.keys(v)
      .filter((k) => !NOISE.has(k) && k !== 'id' && v[k] != null && v[k] !== '')
      .slice(0, 5)
      .map((k) => `${k}: ${short(v[k], 30)}`)
  }
  const s = parts.join('; ')
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** What the record is, in words: its name or title where it has one. */
export function recordLabel(r: Pick<AuditRow, 'record_id' | 'old_values' | 'new_values'>): string {
  const v = { ...(r.old_values ?? {}), ...(r.new_values ?? {}) }
  for (const k of ['name', 'title', 'full_name', 'description', 'landlord', 'class_name', 'product', 'licence_number', 'invoice_no']) {
    if (typeof v[k] === 'string' && (v[k] as string).trim()) return short(v[k], 48)
  }
  return r.record_id ? r.record_id.slice(0, 8) : '—'
}

const ACTION: Record<string, string> = { insert: 'added', update: 'changed', delete: 'deleted' }

export function auditGroups(rows: AuditRow[], who: Map<string, string>, tableLabel: Map<string, string>, tz: string): ReportGroup[] {
  const byDay = new Map<string, Cell[][]>()
  for (const r of rows) {
    const d = new Date(r.changed_at)
    const day = d.toLocaleDateString('en-CA', { timeZone: tz })
    const time = d.toLocaleTimeString('en-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
    const cells: Cell[] = [
      time,
      r.actor_id ? (who.get(r.actor_id) ?? 'someone') : 'the app (sync)',
      tableLabel.get(r.table_name) ?? r.table_name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
      ACTION[r.action] ?? r.action,
      recordLabel(r),
      changeSummary(r),
    ]
    byDay.set(day, [...(byDay.get(day) ?? []), cells])
  }
  return [...byDay].map(([day, list]) => ({ title: day, rows: list }))
}

export const AUDIT_COLUMNS = [{ label: 'Time' }, { label: 'Who' }, { label: 'Table' }, { label: 'Action' }, { label: 'Record' }, { label: 'What changed' }]

export async function gatherAudit(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const from = p.from || ctx.today
  const to = p.to || ctx.today
  if (from > to) throw new Error('The start date is after the end date.')
  const table = pick(p, 'table')
  const people = p.who !== 'all'
  // The whole of each day in the browser's clock, which is the farm's.
  const start = new Date(`${from}T00:00:00`).toISOString()
  const end = new Date(`${to}T23:59:59.999`).toISOString()
  const [rows, users] = await Promise.all([
    fetchAll<AuditRow>((a, b) => {
      let q = supabase.from('audit_log').select('changed_at, table_name, record_id, action, actor_id, old_values, new_values').gte('changed_at', start).lte('changed_at', end)
      if (table) q = q.eq('table_name', table)
      if (people) q = q.not('actor_id', 'is', null)
      return q.order('changed_at', { ascending: false }).order('id', { ascending: false }).range(a, b)
    }),
    fetchAll<{ id: string; full_name: string | null; email: string | null }>((a, b) => supabase.from('users').select('id, full_name, email').order('id').range(a, b)),
  ])
  if (!rows.length) throw new Error(`No ${people ? 'edits by people' : 'changes'} ${table ? `to ${table} ` : ''}between ${from} and ${to}.`)
  const who = new Map(users.map((u) => [u.id, u.full_name || u.email || 'someone']))
  const labels = new Map(AUDIT_TABLES.map((t) => [t.value, t.label]))
  const groups = auditGroups(rows, who, labels, farmTz())
  const count = (a: string) => rows.filter((r) => r.action === a).length
  const tableName = table ? (labels.get(table) ?? table) : 'All tables'
  return {
    title: 'Audit log of edits',
    subtitle: `${longDate(from)} to ${longDate(to)} · ${tableName}${people ? ' · people only' : ''}`,
    meta: [
      ['Changes', rows.length],
      ['Added', count('insert')],
      ['Changed', count('update')],
      ['Deleted', count('delete')],
      ['People', new Set(rows.map((r) => r.actor_id).filter(Boolean)).size],
    ],
    summary: [
      people
        ? 'Every change a signed-in person made, newest first. The app’s own syncs (Deere, FieldNET, the nightly jobs) are left out; choose “Everything” to include them.'
        : 'Every change recorded, newest first, the app’s own syncs included.',
      'Long values are shortened; a deleted or changed record can be put back from its full row in the log.',
    ],
    columns: AUDIT_COLUMNS,
    groups,
    groupLabel: 'Date',
    filename: `Audit log ${from} to ${to}`,
  }
}
