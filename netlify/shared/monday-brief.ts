import type { SupabaseClient } from '@supabase/supabase-js'
import { allocationRow, pivotAllotment, smridAllotmentFor, type PivotRow, type YearAllotment } from '../../src/lib/water-allocation.ts'
import { farmMainRanchId, farmTz } from '../../src/lib/farm-context.ts'

/**
 * The Monday brief: one push to every manager at 7 in the morning with the
 * week in six lines — rain, water, bins, tasks, anything broken, and prices.
 *
 * Each line is left out when it has nothing to say, so a quiet week is a
 * short message rather than a list of zeros.
 */
export async function runMondayBrief(sb: SupabaseClient, opts: { send?: boolean } = {}): Promise<{ lines: string[]; sent: boolean }> {
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const weekAgo = new Date(today.getTime() - 7 * 86_400_000)
  const weekOn = new Date(today.getTime() + 7 * 86_400_000)
  const year = today.getFullYear()
  const lines: string[] = []

  // Rain: last 7 days from the station with the fullest record, next 7 from the forecast at the main ranch
  // (farm setup's main ranch; this farm's has always been Home Ranch, found by name).
  const { data: wx } = await sb.from('weather_daily').select('station_id, precip_mm').gte('date', iso(weekAgo)).lt('date', iso(today))
  const byStation = new Map<string, { n: number; mm: number }>()
  for (const w of wx ?? []) {
    const cur = byStation.get(String(w.station_id)) ?? { n: 0, mm: 0 }
    if (w.precip_mm != null) {
      cur.n++
      cur.mm += Number(w.precip_mm)
    }
    byStation.set(String(w.station_id), cur)
  }
  const past = [...byStation.values()].sort((a, b) => b.n - a.n)[0]
  let ahead: number | null = null
  const mainRanchId = farmMainRanchId()
  const ranchQuery = sb.from('ranches').select('latitude, longitude')
  const { data: ranch } = await (mainRanchId ? ranchQuery.eq('id', mainRanchId) : ranchQuery.eq('name', 'Home Ranch')).maybeSingle()
  if (ranch?.latitude != null) {
    try {
      const r = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${ranch.latitude}&longitude=${ranch.longitude}&daily=precipitation_sum&forecast_days=7&timezone=${encodeURIComponent(farmTz())}`,
        { signal: AbortSignal.timeout(10_000) },
      )
      const j = (await r.json()) as { daily?: { precipitation_sum: (number | null)[] } }
      ahead = (j.daily?.precipitation_sum ?? []).reduce<number>((a, x) => a + Number(x ?? 0), 0)
    } catch {
      ahead = null
    }
  }
  if (past || ahead != null) {
    lines.push(`Rain: ${past ? `${past.mm.toFixed(0)} mm last week` : 'last week not recorded'}${ahead != null ? `, ${ahead.toFixed(0)} mm forecast this week` : ''}.`)
  }

  // Water: fields the balance says need water now, and pivots on pace to run out.
  const { data: latestBal } = await sb.from('water_balance_daily').select('date').eq('is_forecast', false).order('date', { ascending: false }).limit(1)
  if (latestBal?.[0]) {
    const [{ data: bal }, { data: done }] = await Promise.all([
      sb.from('water_balance_daily').select('field_id, status').eq('date', latestBal[0].date).is('zone_id', null),
      // A field marked done for the season is finished, whatever the balance says.
      sb.from('field_crop_seasons').select('field_id').eq('crop_year', year).not('irrigation_done_at', 'is', null),
    ])
    const finished = new Set((done ?? []).map((d) => d.field_id as string))
    const live = (bal ?? []).filter((b) => !finished.has(b.field_id as string))
    const now = live.filter((b) => b.status === 'now' || b.status === 'stress').length
    const soon = live.filter((b) => b.status === 'soon').length
    if (now || soon) lines.push(`Irrigation: ${now} field${now === 1 ? '' : 's'} need water now${soon ? `, ${soon} soon` : ''}.`)
  }
  const [piv, ev, allot] = await Promise.all([
    sb.from('field_pivots').select('field_id, acres_irrigated, alloted_inches, acre_feet_allotment, on_river, smrid_area, water_licence_id, water_source, fields(name)').eq('not_used', false),
    sb.from('irrigation_events').select('field_id, date, gross_mm, net_mm').gte('date', `${year}-01-01`),
    sb.from('water_allotments').select('year, inches, contract_inches').eq('source', 'smrid'),
  ])
  const smrid = smridAllotmentFor((allot.data ?? []) as YearAllotment[], year)
  const runOut = ((piv.data ?? []) as unknown as PivotRow[])
    .map((p) =>
      allocationRow(
        pivotAllotment(p, smrid.inches),
        (ev.data ?? []).filter((e) => e.field_id === p.field_id) as { date: string; gross_mm: number | null; net_mm: number | null }[],
        iso(today),
        `${year}-10-15`,
      ),
    )
    .filter((r) => r.verdict === 'over' || r.verdict === 'will_run_out')
  if (runOut.length) lines.push(`Water allotment: ${runOut.map((r) => r.name).join(', ')} ${runOut.length === 1 ? 'is' : 'are'} over or on pace to run out.`)

  // Bins that need air.
  const { count: air } = await sb.from('bin_air_alerts').select('id', { count: 'exact', head: true }).is('dismissed_at', null)
  if (air) lines.push(`Bins: ${air} need${air === 1 ? 's' : ''} air.`)

  // Tasks due this week, and overdue.
  const { data: tasks } = await sb.from('tasks').select('due_at').eq('status', 'open').not('due_at', 'is', null)
  const overdue = (tasks ?? []).filter((t) => (t.due_at as string) < today.toISOString()).length
  const dueWeek = (tasks ?? []).filter((t) => (t.due_at as string) >= today.toISOString() && (t.due_at as string) < weekOn.toISOString()).length
  if (overdue || dueWeek) lines.push(`Tasks: ${dueWeek} due this week${overdue ? `, ${overdue} overdue` : ''}.`)

  // Anything the watchdog says is broken.
  const { data: broken } = await sb.from('integration_health').select('label, status').eq('enabled', true).neq('status', 'ok')
  if (broken?.length) lines.push(`Feeds needing a look: ${broken.map((b) => b.label).join(', ')}.`)

  // Prices: this week against last, where both exist.
  const move = async (code: string, label: string, unit: string) => {
    const { data: s } = await sb.from('market_series').select('id').eq('code', code).maybeSingle()
    if (!s) return null
    const { data: p } = await sb.from('market_prices').select('value, observed_on').eq('series_id', s.id).not('value', 'is', null).order('observed_on', { ascending: false }).limit(2)
    if (!p || p.length < 2) return null
    const a = Number(p[0].value)
    const b = Number(p[1].value)
    const pct = b ? ((a - b) / b) * 100 : 0
    return `${label} ${unit}${a.toFixed(unit === '$' ? 2 : 0)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`
  }
  const prices = (await Promise.all([move('ab.elevator.canola.central', 'canola', '$'), move('ab.elevator.durum.south', 'durum', '$'), move('dtn.urea', 'urea', 'US$')])).filter(Boolean)
  if (prices.length) lines.push(`Prices: ${prices.join(', ')}.`)

  let sent = false
  if (opts.send !== false && lines.length) {
    const { error } = await sb.rpc('fn_notify_managers', {
      p_kind: 'monday_brief',
      p_title: `Monday brief — ${today.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: farmTz() })}`,
      p_body: lines.join('\n'),
      p_link: '/daybook',
    })
    sent = !error
    if (error) console.warn('[monday-brief] notify failed: ' + error.message)
  }
  await sb.rpc('record_integration_heartbeat', { p_key: 'monday_brief', p_detail: `${lines.length} lines${sent ? ', sent' : ''}`, p_data_at: null })
  return { lines, sent }
}
