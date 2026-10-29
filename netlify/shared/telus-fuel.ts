import type { SupabaseClient } from '@supabase/supabase-js'
import { gaugeInfoText, gaugeReplacesLevel, matchGauges, readGauges, SILENT_HOURS, type GaugeReading, type TankForMatch, type TelusDevice, type TelusPort, type TelusPosition } from '../../src/lib/telus-fuel.ts'
import { farmTz } from '../../src/lib/farm-context.ts'

/**
 * The TELUS Farm Inventory fuel-gauge sync.
 *
 * Telus publishes no API for these gauges (asked around, 19 Oct 2026). Its
 * own web page, farminventory.telus.com, is a Traccar-style app reading a
 * JSON API behind a session cookie, and Sam asked for the app to read it
 * the same way: sign in with the farm's Telus email and password (typed on
 * Farm setup, TELUS_FI_EMAIL / TELUS_FI_PASSWORD), read the gauges, sign out.
 * It can break if Telus changes their site; the watchdog says so when it does.
 *
 *  POST   /api/session          form email, password → JSESSIONID cookie
 *  GET    /api/devices          the gauges
 *  GET    /api/positions        each gauge's latest report (height %, GPS)
 *  GET    /api/devices/port     each gauge's sensor: port, capacity, tank shape
 *  DELETE /api/session          sign out
 *
 * Read only: nothing is ever sent back to Telus but the sign-in.
 */
const BASE = 'https://farminventory.telus.com'
const HEALTH_KEY = 'fuel_telus'

export type TelusSyncResult = { ok: boolean; detail: string; gauges?: number; updated?: number; added?: number; readings?: number }

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ email, password }).toString(),
    redirect: 'manual',
  })
  if (res.status === 401 || res.status === 403) throw new Error('Telus refused the email and password on Farm setup')
  if (!res.ok) throw new Error(`Telus sign-in answered ${res.status}`)
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0])
  if (!cookies.some((c) => c.startsWith('JSESSIONID='))) throw new Error('Telus signed in but gave no session; their site may have changed')
  return cookies.join('; ')
}

async function getJson<T>(path: string, cookie: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie, accept: 'application/json' }, redirect: 'manual' })
  if (!res.ok) throw new Error(`Telus ${path} answered ${res.status}`)
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Telus ${path} did not answer JSON; their site may have changed`)
  }
}

async function writeHealth(sb: SupabaseClient, detail: string) {
  const now = new Date().toISOString()
  const { error } = await sb
    .from('integration_health')
    .update({ status: 'error', detail: detail.slice(0, 300), last_checked_at: now, updated_at: now })
    .eq('source_key', HEALTH_KEY)
  if (error) console.error('[telus-fuel] could not record health:', error.message)
}

const localDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: farmTz() })
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: farmTz() })

type TankRow = TankForMatch & {
  level_at: string | null
  level_source: string | null
  lat: number | null
  lng: number | null
  gauge_online: boolean | null
  gauge_seen_at: string | null
  gauge_info: Record<string, unknown> | null
}

/** What the gauge says about itself, as kept on its tank. */
const gaugeState = (g: GaugeReading) => ({ gauge_online: g.online, gauge_seen_at: g.seenAt, gauge_info: g.info })

const sameTime = (a: string | null, b: string | null) => (a == null || b == null ? a === b : Date.parse(a) === Date.parse(b))

/**
 * A gauge that has not reported for a day: Telus keeps showing its last
 * reading, so the tank's level goes quietly stale while the feed as a whole
 * stays green on the strength of the other gauges. Managers hear once per
 * silence (the key is the gauge and its last report).
 */
async function tellOfSilence(sb: SupabaseClient, g: GaugeReading, tankName: string): Promise<void> {
  const key = `fuel_gauge_silent:${g.deviceId}:${g.readAt}`
  const { data: done } = await sb.from('reminder_log').select('key').eq('key', key).maybeSingle()
  if (done) return
  const why = [
    g.status ? `Telus has it ${g.status}` : null,
    g.seenAt && !sameTime(g.seenAt, g.readAt) ? `last heard from ${shortDate(g.seenAt)}` : null,
    ...gaugeInfoText(g.info),
  ].filter(Boolean)
  const { error } = await sb.rpc('fn_notify_managers', {
    p_kind: 'fuel_gauge_silent',
    p_title: `${tankName} gauge has not reported since ${shortDate(g.readAt)}`,
    p_body: `Its level on Fuel & trucking → Tanks is from then.${why.length ? ` ${why.join(' · ')}.` : ''} Check the gauge's battery and cell signal, or type the level in until it reports again.`,
    p_link: '/fuel?tab=tanks',
  })
  if (error) {
    console.error('[telus-fuel] silent-gauge notice failed:', error.message)
    return
  }
  await sb.from('reminder_log').insert({ key })
}

export async function runTelusFuelSync(sb: SupabaseClient): Promise<TelusSyncResult> {
  const email = process.env.TELUS_FI_EMAIL?.trim()
  const password = process.env.TELUS_FI_PASSWORD
  if (!email || !password) return { ok: false, detail: 'The Telus email and password are not set on Farm setup' }

  let gauges: GaugeReading[]
  try {
    const cookie = await signIn(email, password)
    try {
      const [devices, positions, ports] = await Promise.all([
        getJson<TelusDevice[]>('/api/devices', cookie),
        getJson<TelusPosition[]>('/api/positions', cookie),
        getJson<TelusPort[]>('/api/devices/port', cookie),
      ])
      gauges = readGauges(devices, positions, ports)
    } finally {
      await fetch(`${BASE}/api/session`, { method: 'DELETE', headers: { cookie } }).catch(() => undefined)
    }
  } catch (e) {
    const detail = (e as Error).message
    await writeHealth(sb, detail)
    return { ok: false, detail }
  }

  const { data: tankRows, error: tErr } = await sb
    .from('fuel_tanks')
    .select('id, name, product, capacity_l, telus_device_id, level_at, level_source, lat, lng, gauge_online, gauge_seen_at, gauge_info')
  if (tErr) throw tErr
  const tanks = (tankRows ?? []).map((t) => ({ ...t, capacity_l: Number(t.capacity_l) })) as TankRow[]
  const match = matchGauges(gauges, tanks)

  let updated = 0
  let added = 0
  let readings = 0
  for (const g of gauges) {
    const reading = { level_l: g.litres, level_on: localDate(g.readAt), level_at: g.readAt, level_source: 'telus' }
    let tankId = match.get(g.deviceId) ?? null
    if (!tankId) {
      // A gauge with no tank to go on: add one, named as Telus names it.
      const { data, error } = await sb
        .from('fuel_tanks')
        .insert({ name: g.name, product: g.product, capacity_l: g.capacityL, telus_device_id: g.deviceId, lat: g.lat, lng: g.lng, ...reading, ...gaugeState(g) })
        .select('id')
        .single()
      if (error) throw error
      tankId = data.id as string
      added++
    } else {
      const t = tanks.find((x) => x.id === tankId)!
      const replace = gaugeReplacesLevel(t, g.readAt)
      const stateChanged =
        t.gauge_online !== g.online || !sameTime(t.gauge_seen_at, g.seenAt) || JSON.stringify(t.gauge_info ?? {}) !== JSON.stringify(g.info)
      // Only when something changed: every write is an audit-log row.
      if (t.telus_device_id !== g.deviceId || replace || stateChanged) {
        const pin = t.lat == null && g.lat != null ? { lat: g.lat, lng: g.lng } : {}
        const { error } = await sb
          .from('fuel_tanks')
          .update({ telus_device_id: g.deviceId, ...(replace ? reading : {}), ...gaugeState(g), ...pin, updated_at: new Date().toISOString() })
          .eq('id', tankId)
        if (error) throw error
        if (replace) updated++
      }
    }
    const { error: rErr, count } = await sb
      .from('fuel_tank_readings')
      .upsert({ tank_id: tankId, read_at: g.readAt, pct: g.heightPct, litres: g.litres }, { onConflict: 'tank_id,read_at', ignoreDuplicates: true, count: 'exact' })
    if (rErr) throw rErr
    readings += count ?? 0
  }

  const silent: string[] = []
  for (const g of gauges) {
    if (Date.now() - Date.parse(g.readAt) < SILENT_HOURS * 3_600_000) continue
    const tankId = match.get(g.deviceId)
    const name = tanks.find((t) => t.id === tankId)?.name ?? g.name
    silent.push(`${name} silent since ${shortDate(g.readAt)}${g.status && g.status !== 'online' ? ` (${g.status})` : ''}`)
    await tellOfSilence(sb, g, name)
  }

  const newest = gauges.map((g) => g.readAt).sort().at(-1) ?? null
  const detail =
    `${gauges.length} gauge${gauges.length === 1 ? '' : 's'} read · ${updated} level${updated === 1 ? '' : 's'} changed${added ? ` · ${added} tank${added === 1 ? '' : 's'} added` : ''}` +
    (silent.length ? ` · ${silent.join('; ')}` : '')
  const { error: hErr } = await sb.rpc('record_integration_heartbeat', { p_key: HEALTH_KEY, p_detail: detail, p_data_at: newest })
  if (hErr) console.error('[telus-fuel] heartbeat failed:', hErr.message)
  return { ok: true, detail, gauges: gauges.length, updated, added, readings }
}
