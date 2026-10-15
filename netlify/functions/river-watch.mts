import { createClient } from '@supabase/supabase-js'
import { MANAGER_ROLES } from './_jd.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmTz } from '../../src/lib/farm-context.ts'
import { farmFeatureOn } from '../../src/lib/farm-context.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

// Dam-release watchdog. Hourly, it checks the below-dam station (Brocket) for a
// sharp rise in flow — the signature of the Oldman Dam being opened — and alerts
// managers with the estimated arrival time at Lethbridge, giving lead time before
// the water reaches our reach. Alerts once per rise; re-arms when flow settles.
export const config = { schedule: '35 * * * *' } // hourly at :35

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const HOUR = 3_600_000

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  // Switched off in Farm setup (or a fresh install that has not turned it on).
  if (!farmFeatureOn('river')) return new Response('River levels is switched off in Farm setup', { status: 200 })
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

  const isScheduled = req.method === 'GET' || !req.headers.get('Authorization')
  if (!isScheduled) {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: au } = await getUserMfa(sb, jwt)
    const { data: prof } = au.user
      ? await sb.from('users').select('role, active').eq('id', au.user.id).single()
      : { data: null }
    if (!prof || !MANAGER_ROLES.includes(prof.role) || !prof.active)
      return new Response(JSON.stringify({ error: 'Managers only' }), { status: 403 })
  }

  const { data: cfg } = await sb.from('river_watch').select('*').limit(1).single()
  // Not set up yet is not an error: a fresh install has no gauges chosen, and an
  // hourly 500 would only teach somebody to ignore the logs.
  if (!cfg) return new Response(JSON.stringify({ ok: true, detail: 'River watch is not set up' }), { status: 200 })

  // The "dam" signal is the combined dam-controlled inflow above Lethbridge:
  // Oldman (below dam) + Belly + St. Mary + Waterton. Sum their latest discharge
  // and their pre-rise baseline (lowest in the window) so a release on any of
  // them shows up.
  const stations: string[] =
    (cfg.upstream_stations as string[] | null)?.length
      ? (cfg.upstream_stations as string[])
      : [cfg.upstream_station as string]
  let nowQ = 0
  let baseQ = 0
  let latestT = 0
  let gotAny = false
  for (const st of stations) {
    const res = await fetch(
      `https://api.weather.gc.ca/collections/hydrometric-realtime/items?f=json` +
        `&STATION_NUMBER=${encodeURIComponent(st)}&sortby=-DATETIME&limit=1000`,
    )
    if (!res.ok) continue
    const j = (await res.json()) as { features?: { properties: Record<string, unknown> }[] }
    const pts = (j.features ?? [])
      .map((f) => ({ t: f.properties.DATETIME as string, q: f.properties.DISCHARGE as number | null }))
      .filter((p) => p.t && p.q != null)
      .sort((a, b) => a.t.localeCompare(b.t))
    if (pts.length < 2) continue
    const latest = pts[pts.length - 1]
    const cutoff = new Date(latest.t).getTime() - cfg.rise_window_h * HOUR
    const windowMin = Math.min(...pts.filter((p) => new Date(p.t).getTime() >= cutoff).map((p) => p.q as number))
    nowQ += latest.q as number
    baseQ += windowMin
    latestT = Math.max(latestT, new Date(latest.t).getTime())
    gotAny = true
  }
  if (!gotAny) return new Response(JSON.stringify({ ok: true, note: 'no data' }), { status: 200 })
  const risePct = baseQ > 0 ? ((nowQ - baseQ) / baseQ) * 100 : 0

  const nowIso = new Date().toISOString()
  const patch: Record<string, unknown> = { last_q: nowQ, last_checked_at: nowIso, updated_at: nowIso }
  let alertRaised = false

  const isRelease = nowQ >= cfg.min_q && risePct >= cfg.rise_pct
  if (isRelease && !cfg.alerted) {
    const eta = new Date(latestT + cfg.travel_hours * HOUR)
    const etaStr = eta.toLocaleString('en-CA', {
      timeZone: farmTz(),
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    })
    await sb.rpc('fn_notify_managers', {
      p_kind: 'river_release',
      p_title: `🌊 Upstream dam release — river rising`,
      p_body:
        `Combined dam-controlled inflow (Oldman + Belly + St. Mary + Waterton) is up ${Math.round(risePct)}% to ${Math.round(nowQ)} m³/s. ` +
        `Expect the rise at ${cfg.downstream_label} around ${etaStr} (~${cfg.travel_hours} h out).`,
      p_link: '/irrigation',
    })
    patch.alerted = true
    patch.baseline_q = baseQ
    patch.last_alert_at = nowIso
    alertRaised = true
  } else if (cfg.alerted) {
    // Re-arm once flow has settled back near the pre-release baseline.
    const base = cfg.baseline_q ?? baseQ
    if (nowQ <= base * 1.1) patch.alerted = false
  }

  await sb.from('river_watch').update(patch).eq('id', cfg.id)
  // Heartbeat so the integration-health monitor knows this watcher is alive.
  await sb.rpc('record_integration_heartbeat', {
    p_key: 'river_watch',
    p_detail: `combined inflow ${Math.round(nowQ)} m³/s (${Math.round(risePct)}% over ${cfg.rise_window_h}h)`,
    p_data_at: null,
  })
  return new Response(
    JSON.stringify({ ok: true, nowQ, baseQ, risePct: Math.round(risePct), isRelease, alertRaised }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}
