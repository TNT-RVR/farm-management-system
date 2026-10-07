import type { SupabaseClient } from '@supabase/supabase-js'
import { farmTz } from '../../src/lib/farm-context.ts'
import { firstHardFreeze, freezeNeedsAlert, freezeRuleFrom } from '../../src/lib/freeze-watch.ts'

/**
 * Checklists due before the first hard freeze (winterizing).
 *
 * Runs with the crop-weather job. For every open run of a template marked
 * due_on_freeze, finds the first hard freeze in the 10-day forecast at the
 * farm's main weather site. If there is one: the run (and its assignees'
 * tasks) become due that day, and its assignees and the managers are told,
 * once per freeze (checklist_runs.freeze_alerted_for). The alert kind
 * 'winterizing_freeze' also shows in the Monday meeting's alerts.
 */
export async function runFreezeWatch(sb: SupabaseClient): Promise<{ runs: number; sent: number; detail: string }> {
  const { data: runs, error } = await sb
    .from('checklist_runs')
    .select('id, name, assigned_to, freeze_alerted_for, checklist_templates!inner(due_on_freeze)')
    .eq('status', 'open')
    .eq('checklist_templates.due_on_freeze', true)
  if (error) throw new Error(error.message)
  if (!runs?.length) return { runs: 0, sent: 0, detail: 'no open checklists due on freeze' }

  const [{ data: setup }, { data: setting }] = await Promise.all([
    sb.from('farm_setup').select('forecast_sites').limit(1).maybeSingle(),
    sb.from('operating_settings').select('value').eq('key', 'freeze_watch').maybeSingle(),
  ])
  const sites = ((setup?.forecast_sites ?? []) as { lat: number; lng: number; name: string; main?: boolean }[])
  const site = sites.find((s) => s.main) ?? sites[0]
  if (!site) return { runs: runs.length, sent: 0, detail: 'no forecast site on Farm setup' }
  const rule = freezeRuleFrom(setting?.value)

  const tz = farmTz()
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${site.lat}&longitude=${site.lng}` +
    `&daily=temperature_2m_max,temperature_2m_min&forecast_days=10&timezone=${encodeURIComponent(tz)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const d = ((await res.json()) as { daily?: { time: string[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[] } }).daily
  if (!d) throw new Error('Open-Meteo returned no daily forecast')
  const freeze = firstHardFreeze(d.time.map((date, i) => ({ date, tmin: d.temperature_2m_min[i], tmax: d.temperature_2m_max[i] })), rule)
  if (!freeze) return { runs: runs.length, sent: 0, detail: `no hard freeze in 10 days at ${site.name}` }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz })
  const when = new Date(`${freeze.date}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
  const cold =
    freeze.why === 'night'
      ? `a low of ${Math.round(freeze.tmin!)} °C`
      : `a high of only ${Math.round(freeze.tmax!)} °C (it won't thaw)`
  const { data: managers } = await sb.from('users').select('id').in('role', ['manager', 'admin']).eq('active', true)

  let sent = 0
  for (const r of runs) {
    if (!freezeNeedsAlert(r.freeze_alerted_for as string | null, freeze.date, today)) continue

    const { data: items } = await sb.from('checklist_run_items').select('checked').eq('run_id', r.id)
    const done = (items ?? []).filter((i) => i.checked).length
    const total = (items ?? []).length

    // Due the morning of the freeze, in the farm's time zone (noon UTC keeps the date right).
    const dueAt = `${freeze.date}T12:00:00Z`
    await sb.from('checklist_runs').update({ due_at: dueAt, freeze_alerted_for: freeze.date }).eq('id', r.id)
    await sb.from('tasks').update({ due_at: dueAt }).eq('source', 'checklist').eq('source_ref', r.id)

    const title = `❄️ Hard freeze ${when} — ${r.name} not finished`
    const body = `${cold} forecast at ${site.name}. ${done} of ${total} jobs done. Everything holding water needs to be drained or blown out before then.`
    const link = `/checklists/runs/${r.id}`
    const to = new Set<string>([...((r.assigned_to as string[]) ?? []), ...(managers ?? []).map((m) => m.id as string)])
    for (const user of to) {
      const { error: e } = await sb.rpc('fn_notify', {
        p_user: user,
        p_kind: 'winterizing_freeze',
        p_title: title,
        p_body: body,
        p_link: link,
        p_details: { freeze_date: freeze.date, tmin: freeze.tmin, tmax: freeze.tmax, why: freeze.why, site: site.name, done, total, rule },
      })
      if (e) console.warn('[freeze-watch] notify failed: ' + e.message)
    }
    sent++
  }
  return { runs: runs.length, sent, detail: `hard freeze ${freeze.date} at ${site.name}; ${sent} of ${runs.length} open checklists alerted` }
}
