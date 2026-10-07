import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { cToF, moistureRisk, readingRisk, tempRisk, type RiskLevel } from '@/lib/bale-checks'
import { dateDefault, fetchAll, longDate, pick, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * The bale temperature and moisture log, for the insurer: every check in the
 * dates, who did it, each bale's core temperature and moisture, and how it
 * stood against the hay-fire bands. One group per check.
 */

const db = supabase as unknown as SupabaseClient

type Row = {
  id: string
  checked_on: string
  checked_by: string | null
  ranch_id: string | null
  location: string | null
  air_temp_c: number | null
  notes: string | null
  bale_check_readings: {
    feed_name: string | null
    bale_form: string | null
    stack: string | null
    bale_label: string | null
    temp_c: number | null
    moisture_pct: number | null
    probe_depth_in: number | null
    notes: string | null
    sort_order: number
  }[]
}

const RESULT: Record<RiskLevel, string> = { ok: 'OK', watch: 'Watch', danger: 'DANGER', fire: 'FIRE RISK' }
const FORM: Record<string, string> = { round: 'Round', big_square: 'Big square', small_square: 'Small square' }

export const BALE_COLUMNS = [
  { label: 'Feed' },
  { label: 'Bale' },
  { label: 'Stack / bale' },
  { label: 'Core °C', decimals: 1 },
  { label: 'Core °F', decimals: 0 },
  { label: 'Moisture %', decimals: 1 },
  { label: 'Safe below %', decimals: 0 },
  { label: 'Result' },
  { label: 'Notes' },
]

export function baleGroups(checks: Row[], people: Map<string, string>, ranches: Map<string, string>): { groups: ReportGroup[]; readings: number; flagged: number; hottest: number | null } {
  let readings = 0
  let flagged = 0
  let hottest: number | null = null
  const groups = checks.map((c) => {
    const rows: Cell[][] = [...c.bale_check_readings]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((r) => {
        readings++
        const risk = readingRisk(r)
        if (risk !== 'ok') flagged++
        if (r.temp_c != null) hottest = hottest == null ? r.temp_c : Math.max(hottest, r.temp_c)
        return [
          r.feed_name,
          r.bale_form ? (FORM[r.bale_form] ?? r.bale_form) : null,
          [r.stack, r.bale_label].filter(Boolean).join(' · ') || null,
          r.temp_c,
          r.temp_c == null ? null : cToF(r.temp_c),
          r.moisture_pct,
          moistureRisk(r.moisture_pct, r.bale_form)?.limit ?? null,
          RESULT[risk] + (tempRisk(r.temp_c) && risk !== 'ok' ? ` — ${tempRisk(r.temp_c)!.label}` : ''),
          [r.probe_depth_in ? `probed ${r.probe_depth_in} in` : null, r.notes].filter(Boolean).join('; ') || null,
        ]
      })
    const where = [c.ranch_id ? ranches.get(c.ranch_id) : null, c.location].filter(Boolean).join(' · ')
    return {
      title: `${longDate(c.checked_on)}${where ? ` · ${where}` : ''}`,
      note: [
        `Checked by ${c.checked_by ? (people.get(c.checked_by) ?? 'unknown') : 'unknown'}`,
        c.air_temp_c != null ? `air ${c.air_temp_c} °C` : null,
        c.notes,
      ]
        .filter(Boolean)
        .join(' · '),
      rows,
      empty: 'No bales recorded on this check.',
    }
  })
  return { groups, readings, flagged, hottest }
}

export async function gatherBaleChecks(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const from = pick(p, 'from') ?? dateDefault({ key: 'from', kind: 'date', label: 'From', daysAgo: 365 }, ctx.today)
  const to = pick(p, 'to') ?? ctx.today
  const ranchId = pick(p, 'ranch')
  const [checks, users, ranchRows] = await Promise.all([
    fetchAll<Row>((a, b) => {
      let q = db
        .from('bale_checks')
        .select('id, checked_on, checked_by, ranch_id, location, air_temp_c, notes, bale_check_readings(feed_name, bale_form, stack, bale_label, temp_c, moisture_pct, probe_depth_in, notes, sort_order)')
        .gte('checked_on', from)
        .lte('checked_on', to)
        .order('checked_on')
        .order('id')
      if (ranchId) q = q.eq('ranch_id', ranchId)
      return q.range(a, b)
    }),
    fetchAll<{ id: string; full_name: string }>((a, b) => supabase.from('users').select('id, full_name').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('ranches').select('id, name').order('id').range(a, b)),
  ])
  if (!checks.length) throw new Error(`No bale checks between ${longDate(from)} and ${longDate(to)}.`)
  const ranches = new Map(ranchRows.map((r) => [r.id, r.name]))
  const r = baleGroups(checks, new Map(users.map((u) => [u.id, u.full_name])), ranches)
  return {
    title: 'Bale temperature & moisture log',
    subtitle: `${longDate(from)} – ${longDate(to)} · ${ranchId ? (ranches.get(ranchId) ?? 'one ranch') : 'All ranches'}`,
    meta: [
      ['Checks', checks.length],
      ['Bales probed', r.readings],
      ['Flagged', r.flagged],
      ['Hottest core', r.hottest == null ? '—' : `${r.hottest.toFixed(1)} °C (${cToF(r.hottest).toFixed(0)} °F)`],
    ],
    summary: [
      'Core temperature bands for stored hay: under 52 °C (125 °F) normal; 52–66 °C watch and recheck daily; 66–79 °C danger, check every few hours; 79 °C (175 °F) and over, likely hot spots — call the fire department.',
      'Safe storage moisture: small squares under 20%, round bales under 18%, big squares under 16%.',
    ],
    columns: BALE_COLUMNS,
    groups: r.groups,
    groupLabel: 'Check',
    orientation: 'landscape',
    filename: `bale-checks-${from}-to-${to}`,
  }
}
